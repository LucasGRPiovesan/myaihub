---
name: new-hub-operation
description: Scaffold a new MyAIHub operation following the canonical operation architecture.
disable-model-invocation: true
argument-hint: "[operation name and target]"
---

Create a new MyAIHub operation from:

$ARGUMENTS

Before implementing:

1. Locate the canonical existing operation that best represents the current architecture.
2. Preserve the established operation definition structure.
3. Define the operation domain contract.
4. Configure allowedMutations correctly.
5. Define and validate the output schema.
6. Wire the correct OperationTarget.
7. Preserve required/essential flags.
8. Preserve the established instruction structure.
9. Keep the output contract as the final instruction section.
10. Add or update relevant tests.

Do not invent a new architectural pattern when an established canonical pattern already exists.

Before finishing:
- compare the new operation against an existing canonical operation;
- verify all required wiring exists;
- run the relevant tests and typecheck.