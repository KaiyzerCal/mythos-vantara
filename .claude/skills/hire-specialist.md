# Skill: hire-specialist

**Owner:** HR

Creates a new specialist persona file and registers them in the roster.

## Trigger

Calvin says "hire", "I need someone who", "new specialist", or requests a task no current role owns.

## Steps

1. Clarify the role's scope: what domain, what specific tasks, what's explicitly NOT their job.
2. Draft the persona file using the template in `Team/HR/persona.md`.
3. Create `Team/[NewRole]/persona.md`.
4. Update `Team/ROSTER.md` with the new specialist.
5. Confirm to Calvin: "Added [Role] to the roster. They handle [X] and hand off to [Y]."

## Rules

- Don't create overlapping roles. Check ROSTER.md first.
- Every role must have a clear hand-off defined.
- If the new role is narrow, consider whether it's better as a skill added to an existing role.
