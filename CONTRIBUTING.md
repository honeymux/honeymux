# Contributing to Honeymux

Bug fixes, improvements to existing features, helpful UX tweaks, and other minor updates are always welcome.

Feature suggestions (please file an issue) are also welcome. However, at the time of this writing (April 2026), pull requests that add new features are unlikely to be accepted, until the current feature set sees more widespread testing and hardening. The maintainers believe this is best for the long-term health of the project.

## Guidelines

To increase the likelihood of a successful merge, please ensure your contributions adhere to the following:

- **Take pride in your work.** Whether you employ AI tools or not, laziness will seal your fate. Quality is what matters here.

- **Skilled use of AI tooling is encouraged.** This project would not exist without the powerful models that are available today (see [genesis commit](https://github.com/honeymux/honeymux/commit/4875a4b6664c991656ecef3c01940b88578adc1c)). Skilled means you're not offloading 100% of the thinking and judgment to the LLM -- machines are mechanical, lack taste, and even the frontier models at max inference levels often make poor architectural choices.

- **AGENTS.md is for humans, too.** This is where the expectations around architecture, security concerns, user experience, and other general topics are encoded. Code style and formatting is enforced by automation (eslint, perfectionist, prettier, etc).

- **Post PRs with clean commit stacks.** To maintain a strictly linear git history, all PR merges will be performed with the rebase strategy only. Therefore, keep your PRs in draft state until they are review-ready and merge-ready. Limit each individual commit to a reasonable size that a normal human can fit in their head at one time.

- **Commit messages follow Linux kernel canonical commit-log format.** The 72-column limit leaves room for Git’s indentation (~4 spaces) and email quoting (`>`) so messages remain readable in git log, git show, and patch threads without hard-wrapping at 80 columns (the traditional terminal screen width, which is still a baseline assumption in low-level tooling ecosystems).

- **Be concise, but descriptive.** It takes next to zero effort to have an LLM prepare commit messages for you, so this project strictly requires both a summary line and body. That said, most commits should not need more than 1 or 2 paragraphs to adequately describe.

- **When in doubt, follow existing patterns.** If this process seems daunting, don't worry -- there are plenty of existing examples to look at!

Finally, please know that the author has a day job and life outside of open source, so response times will vary accordingly.
