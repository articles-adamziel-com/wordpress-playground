---
title: Adding PR Preview Buttons with GitHub Actions
slug: /guides/github-action-pr-preview
description: Automatically add Playground preview buttons to pull requests for your WordPress plugin or theme.
---

The Playground PR Preview action adds a preview button to your pull requests. Clicking the button launches Playground with your plugin or theme installed from the PR branch:

![PR Preview Button](@site/static/img/try-it-in-playground.webp)

For complete configuration options and advanced features, see the [action-wp-playground-pr-preview workflow README](https://github.com/WordPress/action-wp-playground-pr-preview/tree/v2).

:::warning This is a regular action, not a reusable workflow

Reference `WordPress/action-wp-playground-pr-preview@v2` from inside `jobs.<job_id>.steps`, not from `jobs.<job_id>.uses`. GitHub only allows `jobs.<job_id>.uses` for reusable workflows that point to another workflow file (e.g. `owner/repo/.github/workflows/file.yml@ref`). Using it at the job level here will fail with an error like `invalid value workflow reference`.

```yaml
# ❌ Wrong — this syntax is only for reusable workflows
jobs:
    preview:
        uses: WordPress/action-wp-playground-pr-preview@v2

# ✅ Correct — actions go inside steps
jobs:
    preview:
        runs-on: ubuntu-latest
        steps:
            - uses: WordPress/action-wp-playground-pr-preview@v2
```

:::

## How it works

The action runs on pull request events (opened, updated, edited, reopened, synchronize). It can either update the PR description with a preview button or post the button as a comment.

## Basic setup for plugins

For plugins without a build step, create `.github/workflows/pr-preview.yml`:

```yaml
name: PR Preview
on:
    pull_request:
        types: [opened, synchronize, reopened, edited]

jobs:
    preview:
        runs-on: ubuntu-latest
        permissions:
            contents: read
            pull-requests: write
        steps:
            - name: Post Playground Preview Button
              uses: WordPress/action-wp-playground-pr-preview@v2
              with:
                  mode: 'append-to-description'
                  plugin-path: .
```

The `plugin-path: .` setting points to your plugin directory. For subdirectories like `plugins/my-plugin`, use `plugin-path: plugins/my-plugin`.

The `permissions` block is required: the action needs `pull-requests: write` to update the PR description or post a comment. `github-token` is optional and defaults to the workflow's built-in `GITHUB_TOKEN` — set it only when you need a different token.

See [adamziel/preview-in-playground-button-plugin-example](https://github.com/adamziel/preview-in-playground-button-plugin-example/pull/3) for a live example of this workflow in action.

## Basic setup for themes

For themes, use `theme-path` instead of `plugin-path`:

```yaml
name: PR Preview
on:
    pull_request:
        types: [opened, synchronize, reopened, edited]

jobs:
    preview:
        runs-on: ubuntu-latest
        permissions:
            contents: read
            pull-requests: write
        steps:
            - name: Post Playground Preview Button
              uses: WordPress/action-wp-playground-pr-preview@v2
              with:
                  theme-path: .
```

## Button placement

By default, the action updates the PR description (`mode: append-to-description`). To post as a comment instead:

```yaml
with:
    plugin-path: .
    mode: comment
```

The action wraps the button in HTML markers and updates it on subsequent runs. By default, it restores the button if you remove it. To prevent restoration:

```yaml
with:
    plugin-path: .
    restore-button-if-removed: false
```

## Working with built artifacts

:::caution Pull requests from forks

Workflows triggered by `pull_request` from a forked repository run with restricted permissions: they cannot write to the PR, access secrets, or publish releases. If you need to support fork PRs, split the work into two workflows — a `pull_request`-triggered build that uploads artifacts, and a `workflow_run`-triggered publish step that posts the preview. See the [Advanced: Testing Built CI Artifacts](https://github.com/WordPress/action-wp-playground-pr-preview/tree/v2#advanced-testing-built-ci-artifacts) section of the README for the full two-workflow pattern. Avoid `pull_request_target` unless you fully understand the [security implications](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) — it runs with write access to your repository.

:::

For plugins or themes requiring compilation, the workflow involves building the code, exposing it via GitHub releases, and creating a blueprint that references the public URL.

Example workflow (see [complete documentation](https://github.com/WordPress/action-wp-playground-pr-preview/tree/v2#advanced-testing-built-ci-artifacts)):

```yaml
name: PR Preview with Build
on:
    pull_request:
        types: [opened, synchronize, reopened, edited]

permissions:
    contents: write
    pull-requests: write

jobs:
    build:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - name: Build
              run: |
                  npm install
                  npm run build
                  zip -r plugin.zip dist/
            - uses: actions/upload-artifact@v4
              with:
                  name: built-plugin
                  path: plugin.zip

    expose-build:
        needs: build
        runs-on: ubuntu-latest
        permissions:
            contents: write
        outputs:
            artifact-url: ${{ steps.expose.outputs.artifact-url }}
        steps:
            - name: Expose built artifact
              id: expose
              uses: WordPress/action-wp-playground-pr-preview/.github/actions/expose-artifact-on-public-url@v2
              with:
                  artifact-name: 'built-plugin'
                  pr-number: ${{ github.event.pull_request.number }}
                  commit-sha: ${{ github.sha }}
                  artifacts-to-keep: '2'

    create-blueprint:
        needs: expose-build
        runs-on: ubuntu-latest
        outputs:
            blueprint: ${{ steps.blueprint.outputs.result }}
        steps:
            - uses: actions/github-script@v7
              id: blueprint
              with:
                  script: |
                      const blueprint = {
                        steps: [{
                          step: "installPlugin",
                          pluginZipFile: {
                            resource: "url",
                            url: "${{ needs.expose-build.outputs.artifact-url }}"
                          }
                        }]
                      };
                      return JSON.stringify(blueprint);
                  result-encoding: string

    preview:
        needs: create-blueprint
        runs-on: ubuntu-latest
        permissions:
            pull-requests: write
        steps:
            - uses: WordPress/action-wp-playground-pr-preview@v2
              with:
                  github-token: ${{ secrets.GITHUB_TOKEN }}
                  blueprint: ${{ needs.create-blueprint.outputs.blueprint }}
```

The `artifacts-to-keep` setting controls how many builds to retain per PR. For themes, change `installPlugin` to `installTheme`.

See [adamziel/preview-in-playground-button-built-artifact-example](https://github.com/adamziel/preview-in-playground-button-built-artifact-example/pull/2) for a complete working example.

## Custom blueprints

Use blueprints to configure the Playground environment. You can install additional plugins, set WordPress options, import content, or run custom PHP.

Example installing your plugin with WooCommerce:

```yaml
jobs:
    create-blueprint:
        name: Create Blueprint
        runs-on: ubuntu-latest
        outputs:
            blueprint: ${{ steps.blueprint.outputs.result }}
        steps:
            - name: Create Blueprint
              id: blueprint
              uses: actions/github-script@v7
              with:
                  script: |
                      const blueprint = {
                        steps: [
                          {
                            step: "installPlugin",
                            pluginData: {
                              resource: "git:directory",
                              url: `https://github.com/${context.repo.owner}/${context.repo.repo}.git`,
                              ref: context.payload.pull_request.head.ref,
                              path: "/"
                            }
                          },
                          {
                            step: "installPlugin",
                            pluginData: {
                              resource: "wordpress.org/plugins",
                              slug: "woocommerce"
                            }
                          }
                        ]
                      };
                      return JSON.stringify(blueprint);
                  result-encoding: string

    preview:
        needs: create-blueprint
        runs-on: ubuntu-latest
        permissions:
            pull-requests: write
        steps:
            - uses: WordPress/action-wp-playground-pr-preview@v2
              with:
                  github-token: ${{ secrets.GITHUB_TOKEN }}
                  blueprint: ${{ needs.create-blueprint.outputs.blueprint }}
```

Or reference an external blueprint:

```yaml
with:
    blueprint-url: https://example.com/path/to/blueprint.json
```

See [Blueprints documentation](/blueprints) for all available steps and configuration options.

## Template customization

Customize the preview content using template variables:

```yaml
with:
    plugin-path: .
    description-template: |
        ### Test this PR in WordPress Playground

        {{PLAYGROUND_BUTTON}}

        **Branch:** {{PR_HEAD_REF}}
```

Available variables:

- Playground: `{{PLAYGROUND_BUTTON}}`, `{{PLAYGROUND_URL}}`, `{{PLAYGROUND_BUTTON_IMAGE_URL}}`, `{{PLAYGROUND_BLUEPRINT_JSON}}`, `{{PLAYGROUND_BLUEPRINT_DATA_URL}}`, `{{PLAYGROUND_HOST}}`
- Pull request: `{{PR_NUMBER}}`, `{{PR_TITLE}}`, `{{PR_HEAD_REF}}`, `{{PR_HEAD_SHA}}`, `{{PR_BASE_REF}}`
- Repository: `{{REPO_OWNER}}`, `{{REPO_NAME}}`, `{{REPO_FULL_NAME}}`, `{{REPO_SLUG}}`
- Project: `{{PLUGIN_PATH}}`, `{{PLUGIN_SLUG}}`, `{{THEME_PATH}}`, `{{THEME_SLUG}}`

The same variables work with `comment-template` when using `mode: comment`. See the [workflow README](https://github.com/WordPress/action-wp-playground-pr-preview/tree/v2#description-template) for default templates and examples.

## Artifact exposure

The `expose-artifact-on-public-url` action uploads built files to a single release (tagged `ci-artifacts` by default). Each artifact gets a unique filename like `pr-123-abc1234.zip`. Old artifacts are automatically cleaned up based on `artifacts-to-keep`.

Configuration options: [Expose Artifact Inputs](https://github.com/WordPress/action-wp-playground-pr-preview/tree/v2#expose-artifact-inputs)

## Troubleshooting

**`invalid value workflow reference` or `workflow was not found`:** You referenced the action at the job level (`jobs.<id>.uses:`) instead of inside a step (`jobs.<id>.steps[].uses:`). See the warning at the top of this page.

**Button not appearing on a new PR:** The workflow file must exist on the default branch (usually `trunk` or `main`). GitHub Actions does not run workflow files that only exist on feature branches for `pull_request` events. Also check the Actions tab for failed runs.

**`Resource not accessible by integration` / 403 when updating the PR:** The job is missing `permissions: pull-requests: write`. Set it at the job level as shown in the [basic setup](#basic-setup-for-plugins). For PRs from forks, the default `GITHUB_TOKEN` is read-only regardless of the `permissions` block — see the fork callout in [Working with built artifacts](#working-with-built-artifacts).

**Preview fails to load in Playground:** Verify `plugin-path` or `theme-path` points to a directory containing a valid plugin or theme (with the appropriate header comment in the main PHP file or `style.css`). For built artifacts, check the build job's logs and confirm the artifact was uploaded.

**Plugin/theme not activated:** Open the browser console inside the Playground preview for PHP errors. Missing PHP extensions or unmet dependencies are the usual cause; a custom blueprint can install dependencies first.

**Button keeps coming back after I delete it:** Set `restore-button-if-removed: false`.

More: [workflow README](https://github.com/WordPress/action-wp-playground-pr-preview/tree/v2)

## Examples

- [WordPress/blueprints](https://github.com/WordPress/blueprints/pull/155) - Blueprint previews
- [adamziel/preview-in-playground-button-plugin-example](https://github.com/adamziel/preview-in-playground-button-plugin-example/pull/3) - Plugin without build
- [adamziel/preview-in-playground-button-built-artifact-example](https://github.com/adamziel/preview-in-playground-button-built-artifact-example/pull/2) - Plugin with build

## Next steps

- Add demo content ([guide](/guides/providing-content-for-your-demo))
- Create custom blueprints ([docs](/blueprints))
- Integrate with testing workflows
- Customize templates for reviewers
