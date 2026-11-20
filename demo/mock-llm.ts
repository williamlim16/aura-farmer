import { ScriptedLlm } from "~/lib/apply/decision/llm";

/**
 * MOCK LLM for the demo. Makes no network calls. It imitates a cautious,
 * profile-grounded model: it drafts short free-text answers from the job
 * context and picks a select option only when one matches a known
 * residence country. Everything else it declines (value "").
 */
export function demoMockLlm() {
  return new ScriptedLlm((fields) =>
    fields.map((f) => {
      if (/why|interest|motivat|tell us|cover note|additional/i.test(f.label) && !f.options?.length) {
        return {
          id: f.id,
          value: "[Mock draft] I build reliable TypeScript web platforms and would bring that experience to this team. Please edit before submitting.",
          confidence: 0.75,
          needs_confirmation: true,
        };
      }
      if (/country/i.test(f.label) && f.options?.includes("Australia")) return { id: f.id, value: "Australia", confidence: 0.85 };
      return { id: f.id, value: "", confidence: 0 };
    }),
  );
}
