# Exodus product prototype

## Goal
Build a polished, fully interactive local prototype of Exodus: a calm private AI workspace centered on threaded conversations, project creation, and lightweight project context. It will use realistic mock data and simulated sign-in only, with no live database, AI, repository, execution, deployment, or API-key connections.

## Product structure
- Add a simulated sign-in screen using the Exodus identity and a clear “Enter workspace” flow.
- Build the signed-in application shell with a collapsible desktop sidebar, mobile drawer, spacious conversation center, responsive top bar, and collapsible context panel that becomes a mobile sheet.
- Give every conversation a dedicated URL and keep mock threads, newly created threads, active workspace, active project, and UI preferences in browser storage so refreshes restore the same prototype state.
- Include General and Coding Workspace modes, project navigation, recent conversations, settings, sign out, model status, and useful mobile controls.

## Core flows
- **General chat:** welcome suggestions plus a realistic sample conversation containing structured text, a list, and a code example.
- **Coding workspace:** coding-specific suggestions and a sample clarification-to-implementation-plan conversation.
- **New chat:** creates a fresh thread, navigates to its URL, focuses the composer, and shows immediate simulated user/assistant feedback.
- **New project:** guided multi-step flow covering details, manual or recommended stack selection, design direction, repository state, complexity, review, and successful mock creation.
- **Project overview:** show the selected project’s status, stack, recent conversation, active tasks, memory, files, decisions, changelog, and preview/export area without turning the main experience into a dashboard grid.
- **Models and tools:** clean provider cards for Kimi K2, general, vision/image, document, and voice tools with mock connection/default states, masked placeholders, and working simulated configuration actions.
- **Context panel:** working Project, Files, Tasks, Memory, and Activity tabs with realistic Exodus and Gardens Zero content, file selection, status, and simulated download/export feedback.

## Visual direction
- Use the supplied Exodus logo directly and derive the interface palette from its cyan/turquoise, pink/magenta, and soft lavender tones.
- Keep warm-white surfaces, deep charcoal text, quiet gray borders, restrained gradients, subtle shadows, compact rounded panels, generous spacing, and an editorial modern sans-serif.
- Keep the conversation visually dominant; use the gradient only for selected states, the primary action, and small atmospheric details.
- Add restrained transitions for drawers, panels, messages, loading, success, and navigation, with reduced-motion support.
- Ensure touch-friendly controls, unclipped text, accessible contrast, visible focus states, keyboard-friendly forms, and responsive layouts.

## States and interactions
- Working workspace/project/thread switching, sidebar collapse, context tabs, model selection, menu actions, sign-in/sign-out simulation, and local thread creation.
- Working composer controls with attachments/voice shown as simulated states, disabled/loading/success feedback, and mock assistant responses.
- Purposeful empty, loading, error, unavailable, and coming-soon states; Tend and unfinished article/content work remain clearly labeled “Coming soon.”
- No dead controls: unfinished capabilities explain their simulated or unavailable state.

## Technical approach
- Organize reusable shell, navigation, chat, context, project-flow, settings, and shared control components separately from typed mock data and browser-storage helpers.
- Use TanStack routes for sign-in, threaded conversation URLs, project overview, and settings; navigation state comes from the current URL where applicable.
- Keep the data boundary replaceable so later authentication, database, AI streaming, and repository services can be integrated without redesigning the visible product.
- Use semantic design tokens in the global style system and project UI primitives for interactive controls.
- Add app-specific metadata for every content route and preserve the current TanStack application architecture.

## Validation
- Check the complete interaction flow on desktop and mobile: simulated sign-in, workspace switching, two distinct threads with reload restoration, new project review/create, project selection, context tabs, model selection, and sign-out.
- Verify keyboard focus, responsive drawers/sheets, visible loading/success/error states, and no layout overlap.
- Run the relevant routing tests and inspect the final preview for runtime, console, network, and build errors.
