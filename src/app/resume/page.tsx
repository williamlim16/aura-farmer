import { redirect } from "next/navigation";

/** The upload prototype moved into the integrated profile workflow. */
export default function ResumePage() {
  redirect("/apply/profile");
}
