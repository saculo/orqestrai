// The task file templates, built into orq (and into the compiled binary) as text.
import BRIEF from "../templates/BRIEF.md" with { type: "text" }
import LEARN from "../templates/LEARN.md" with { type: "text" }
import PR from "../templates/PR.md" with { type: "text" }
import RESEARCH from "../templates/RESEARCH.md" with { type: "text" }
import SPEC from "../templates/SPEC.md" with { type: "text" }
import VERIFY from "../templates/VERIFY.md" with { type: "text" }
import type { TEMPLATES } from "./domain.ts"

export const templates: Record<(typeof TEMPLATES)[number], string> = { BRIEF, RESEARCH, SPEC, VERIFY, LEARN, PR }
