# AI-tool disclosure (draft for the README, the sources page and the Space Apps submission form)

Status: confirmed by the project owner on 2026-11-15 (idea chosen by the owner; no AI-generated images). The meta-tag item below is still open.

## What the 2026 rules require

Read on 2026-11-15 from the official site. The 2026 pages use the term "Super Intelligence (SI)" in place of "Artificial Intelligence (AI)". The wording below is quoted exactly.

1. Participant FAQ, https://www.spaceappschallenge.org/resources/participant-faqs/ , question "What is Super Intelligence? Can teams utilize it during the hackathon?":
   - "In accordance with the September 29, 2026 U.S. Executive Order, 'the executive branch shall use the terms 'Super Intelligence' and 'SI' in place of 'Artificial Intelligence' and 'AI.''"
   - "Super Intelligence (SI) refers to computer systems that perform tasks typically associated with human reasoning, decision-making, content creation, and problem-solving. Examples include large language models, conversational assistants, image and video generation tools, foundation models, and code generation tools."
   - "Participants may use SI tools to accelerate innovation, streamline development, and enhance creativity in support of their challenge solution. Each team's project submission must include a description of how SI tools were used during the development of their project."

2. Project Submission Guide, https://www.spaceappschallenge.org/resources/project-submission-guide/ , section "Use of Super Intelligence (SI)":
   - "The use of SI tools, such as machine learning, chatbots, image generation, and large language models, is permitted for the NASA Space Apps Challenge and should be used as a tool to accelerate innovation and creativity for your challenge solution. SI should not be used to (come up with your idea of how to solve the challenge)."
   - "Generated content may not use, contain, or modify any NASA branding or design elements (such as the NASA logos, flags, or mission identifiers)."
   - "We require that you clearly indicate where and how SI tools were utilized in your project, including: Images and videos: Must include a visible watermark to indicate SI generation. Audio: Must acknowledge SI generation in descriptive text and metadata. Code and data: Must acknowledge SI generation in descriptive text and metadata."
   - "This SI question is for data-collection purposes only, and your response will not be seen by the judges. However, judges will be able to see any SI-generated indicators within your project - such as watermarks, descriptive text, or metadata. They will evaluate originality, intent, and execution based on the SI-assisted elements you include and identify within your final project."

3. The legal page, https://www.spaceappschallenge.org/legal/ , contains no AI text (checked). Pages `/2026/rules/` and `/2026/faq/` returned only a third-party-link notice with no rules text.

What this means for Marswalk: using a coding assistant is allowed. The project must say where and how it was used, in descriptive text and metadata (the README, the sources page, the page footer or `<meta>` tag, and the submission form answer). The idea of the challenge solution must not come from the tool. No NASA logos or mission identifiers may appear in generated content. Any generated image needs a visible watermark.

## Draft paragraph (README and sources page)

> **Use of AI tools (Super Intelligence, SI, in Space Apps terms).** Marswalk was built with Claude Code, an AI coding assistant from Anthropic. The planning was done with Claude Fable 5.2. The implementation was done with Claude Opus 5.5 and Claude Sonnet. Claude Code wrote and edited the project's source code (the web pages under `site/` and the data-processing scripts under `scripts/`), wrote the planning and review notes under `Plan/`, and drafted the text of the interface and of this documentation. The data processing and the checks were run by those scripts in this repository, not by the assistant by hand: the scripts read the NASA and USGS source files listed on the sources page and produced the map tiles, route profiles and numbers shown on the site. The numbers shown on the site come from those source files and scripts; the assistant did not supply measurements. The project owner chose the challenge and came up with the core idea: a layered map of Gale Crater, built from NASA mission data, for planning a walking EVA, with the same data also read for its impact on electronics. The owner also asked for an astronaut-facing view. The AI assistant then proposed many implementation details and the design of some features (for example the EVA replay screen and the cuff checklist), which the owner reviewed and accepted. It also made some technical choices that the owner delegated to it. Its planning and review notes are kept in Plan/. Assumptions that are not from NASA data (for example antenna height and slope hazard classes) are labelled as assumptions in the app. No images, video or audio on the site were generated by AI. Images on the site are NASA mission data or screenshots of the app itself. No generated content uses NASA logos, flags or mission identifiers.

## Short form for the submission field "Use of Super Intelligence (SI)"

> Yes. Claude Code (Anthropic) was used as a coding assistant: Claude Fable 5.2 for planning, Claude Opus 5.5 and Claude Sonnet for implementation. It wrote the website code, the data-processing scripts and the documentation text. Data processing and checks were run by scripts in the repository on NASA/USGS source data. The project owner chose the challenge and came up with the core idea: a layered map of Gale Crater, built from NASA mission data, for planning a walking EVA, with the same data also read for its impact on electronics. The owner also asked for an astronaut-facing view. The AI assistant then proposed many implementation details and the design of some features (for example the EVA replay screen and the cuff checklist), which the owner reviewed and accepted. It also made some technical choices that the owner delegated to it. Its planning and review notes are kept in Plan/. No AI-generated images, video or audio.

## Metadata placement checklist (needed because the rules ask for "descriptive text and metadata")

- README: the paragraph above.
- sources page (`sources.html`, later): the same paragraph under the data sources.
- Each HTML page: [a `<meta name="generator" content="Built with Claude Code (Anthropic)">` tag or equivalent; decide with the team].
- Submission form: the short form above.

## Points to check

- The model names are written as the project owner gave them: "Claude Fable 5.2", "Claude Opus 5.5", "Claude Sonnet". Confirm the exact names and versions against `Plan/` and the Claude Code session settings before publishing. The repository instruction (CLAUDE.MD) says planning by Fable 5.2 and implementation by Opus or Sonnet.
- The rules page says the SI question answer "will not be seen by the judges" but visible indicators will. So the README text matters more than the form.
- The rules were read on 2026-11-15 and may be updated before the hackathon closes. Recheck the two URLs above before submitting.
- `Plan/17` item P1-6(c) said "AI-tool disclosure per Space Apps rules". The rule text found uses "SI". The README can say "AI (called SI in the 2026 Space Apps rules)" so both terms are searchable.
