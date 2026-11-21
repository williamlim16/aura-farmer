/**
 * Local development database without Docker: PGlite (real Postgres compiled
 * to WASM) persisted under .data/pglite and served over the Postgres wire
 * protocol on 127.0.0.1, so the Next.js app and the worker process share it.
 * Applies drizzle/ migrations on start. Development and tests only.
 *
 * PGlite is a single session. This server serialises clients at protocol
 * batch granularity: a client's messages are buffered until Sync / Query /
 * Terminate and executed as one unit, and while that client has a transaction
 * open no other client runs. (Per-message multiplexing interleaves extended-
 * protocol Parse/Bind pairs between connections and corrupts queries, which
 * we hit with @electric-sql/pglite-socket.) postgres-js may also describe a
 * statement in one round (Parse/Describe/Sync) and execute it in the next
 * (Bind/Execute/Sync); the unnamed statement lives in the shared session, so
 * a client keeps the lock after a describe-only round until it executes
 * (bounded by a short timeout).
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_3 = 196608;

class SessionLock {
  private owner: number | null = null;
  private waiters: (() => void)[] = [];
  private holdTimer: NodeJS.Timeout | undefined;
  async acquire(id: number) {
    while (this.owner !== null && this.owner !== id) await new Promise<void>((r) => this.waiters.push(r));
    clearTimeout(this.holdTimer);
    this.owner = id;
  }
  /** Keep ownership briefly for a follow-up round from the same client. */
  hold(ms: number) {
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => this.release(), ms);
  }
  release() {
    clearTimeout(this.holdTimer);
    this.owner = null;
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }
}

function serve(pg: PGlite, host: string, port: number) {
  const lock = new SessionLock();
  let closed = false;
  let nextId = 1;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    const id = nextId++;
    sockets.add(socket);
    socket.setNoDelay(true);
    let buf = Buffer.alloc(0);
    let started = false;
    let batch: Buffer[] = [];
    let chain = Promise.resolve();

    const runBatch = (messages: Buffer[]) => {
      chain = chain.then(async () => {
        await lock.acquire(id);
        try {
          for (const m of messages) {
            await pg.execProtocolRawStream(new Uint8Array(m), {
              onRawData: (d) => {
                if (d.length && socket.writable) socket.write(Buffer.from(d));
              },
            });
          }
        } finally {
          // Keep the session while this client is in a transaction, or after a
          // describe-only round whose Bind/Execute will follow.
          const executes = messages.some((m) => m[0] === 0x45 /* E */ || m[0] === 0x51 /* Q */);
          if (closed) lock.release();
          else if (pg.isInTransaction()) lock.hold(30_000);
          else if (!executes && messages.some((m) => m[0] === 0x50 /* P */)) lock.hold(2_000);
          else lock.release();
        }
      }).catch(() => {
        socket.destroy();
      });
    };

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!started) {
          if (buf.length < 8) return;
          const len = buf.readInt32BE(0);
          const code = buf.readInt32BE(4);
          if (code === SSL_REQUEST) {
            buf = buf.subarray(8);
            socket.write("N");
            continue;
          }
          if (code === CANCEL_REQUEST) {
            buf = buf.subarray(len);
            continue;
          }
          if (buf.length < len) return;
          if (code !== PROTOCOL_3) return socket.destroy();
          started = true;
          runBatch([buf.subarray(0, len)]);
          buf = buf.subarray(len);
          continue;
        }
        if (buf.length < 5) return;
        const type = String.fromCharCode(buf[0]!);
        const len = 1 + buf.readInt32BE(1);
        if (buf.length < len) return;
        const msg = buf.subarray(0, len);
        buf = buf.subarray(len);
        if (type === "X") {
          if (batch.length) runBatch(batch);
          batch = [];
          void chain.then(() => socket.end());
          return;
        }
        batch.push(msg);
        if (type === "S" || type === "Q" || type === "H") {
          runBatch(batch);
          batch = [];
        }
      }
    });
    const cleanup = () => {
      sockets.delete(socket);
      // A client that vanished mid-transaction must not block everyone else.
      void chain.then(async () => {
        if (closed) return;
        await lock.acquire(id);
        try {
          if (!closed && pg.isInTransaction()) await pg.exec("ROLLBACK");
        } catch {
          /* database closing */
        } finally {
          lock.release();
        }
      });
    };
    socket.on("close", cleanup);
    socket.on("error", () => socket.destroy());
  });

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(port, host, () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () =>
          new Promise<void>((r) => {
            closed = true;
            sockets.forEach((s) => s.destroy());
            server.close(() => r());
          }),
      });
    });
  });
}

export async function startDevDb(opts: { dir?: string; port?: number } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("The dev database must not run in production.");
  const dir = opts.dir ?? path.resolve(".data/pglite");
  if (dir !== "memory://") fs.mkdirSync(dir, { recursive: true });
  const pg = await PGlite.create(dir);
  await migrate(drizzle(pg), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  const srv = await serve(pg, "127.0.0.1", opts.port ?? 54329);
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${srv.port}/postgres`,
    stop: async () => {
      await srv.close();
      await pg.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  void startDevDb().then((db) => {
    console.log(`[dev-db] PGlite on ${db.url}`);
    const stop = () => void db.stop().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
