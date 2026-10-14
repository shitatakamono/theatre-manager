# Team authentication migration

Access is strict by default. Only projects whose `memberUids` contains the signed-in user's UID and whose matching member document exists are shown.

For a limited local migration window only, set `NEXT_PUBLIC_PROJECT_ACCESS_MODE=legacy` explicitly. In legacy mode, existing projects without `memberUids` are shown to signed-in users as legacy editor access. This compatibility mode does not write to Firestore and never chooses an owner automatically. Do not enable legacy mode in a deployed environment, and do not deploy the strict Firestore rules until every project that must remain accessible has been migrated.

Before deploying `firestore.rules`, migrate each existing project with a known owner UID by using the Firebase Console or a separately reviewed Admin SDK operation:

1. Create `projects/{projectId}/members/{ownerUid}` with `uid`, `displayName`, `email`, `photoURL`, `role: "owner"`, `createdAt`, and `updatedAt`.
2. Add the same UID to the project document as `memberUids: [ownerUid]`.
3. Repeat for every existing project and verify the intended owner with the team.
4. Remove the legacy override (or set `NEXT_PUBLIC_PROJECT_ACCESS_MODE=strict`), rebuild, and only then deploy the reviewed Firestore rules.

Do both document changes as one Admin SDK batch where possible. Do not run this migration from the browser and do not infer ownership from the first user who signs in.

The Phase 1 member screen can change or remove existing members. Adding the first owner to a legacy project and inviting brand-new members remain controlled migration/administration operations.

The shared `categories` collection remains a Phase 1 global master. Its current rule allows every authenticated user to read and write it. This is intentionally unchanged for compatibility, but it is broader than project-scoped access and should be redesigned before roles are expected to govern category administration.
