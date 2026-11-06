# Contributing to Solus

Thanks for helping. Issues and pull requests are welcome.

## Getting started

```bash
pnpm install
pnpm dev --repo ../some-repo --fake   # real git, with a fake agent that needs no login
pnpm lint && pnpm typecheck && pnpm test
```

`CLAUDE.md` describes how the product works and the conventions to follow. Please keep changes focused, and make sure lint, typecheck and tests pass.

Agents can't be started from inside a Claude Code session. Run Solus from a normal terminal when testing with real agents.

## Licence

Solus is under the [Apache License 2.0](LICENSE). By submitting a contribution you agree it's licensed under the same terms, as section 5 of the licence describes.

## Reporting a security problem

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repo.
