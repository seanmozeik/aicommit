# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2026-01-26

### Changed
- Improve banner appearance by loading fonts lazily, resulting in a quicker display
- Improve startup speed in bundled builds by showing the banner asynchronously

## [0.3.1] - 2026-01-22

### Added
- Add a `generateMessage` function that creates AI-generated messages

### Changed
- Update AI provider logic to automatically choose the best provider for each request
- Update secrets configuration to support improved security and flexibility

## [0.3.0] - 2026-01-22

### Added
- Add support for configuring multiple AI providers, allowing you to choose between OpenAI, Anthropic, Cloudflare, and more.
- Improve secrets handling, ensuring safer and simpler management of API keys and sensitive data.

## [0.2.9] - 2026-01-21

### Changed
- Improve the AI output spinner to provide a smoother and more responsive progress display while generating responses.
- Update commit message validation to offer clearer guidance with a simpler rule set, making it easier to craft acceptable commit messages.

## [0.2.8] - 2026-01-21

### Added
- Add `--help` flag to the aic CLI to display usage information.
- Add `--version` flag to the aic CLI to show the current version.

## [0.2.7] - 2026-01-13

### Fixed
- Fix spinner artifacts during release.

## [0.2.6] - 2026-01-13

### Added
- Add a `changelog-latest` command that shows the most recent changelog entry.

### Fixed
- Fix terminal output during release prompts so spinner artifacts no longer appear.

## [0.2.5] - 2026-01-13

### Added
- Add example configuration file for AIC
- Add Linux support to the formula

## [0.2.4] - 2026-01-13

### Added
- Add multiline support in AIC scripts, allowing line continuations with backslashes

## [0.2.3] - 2026-01-13

### Fixed
- Fix git-based commands to automatically run from the repository root.

## [0.2.2] - 2026-01-13

### Changed
- Improve release process by eliminating listener warnings and ensuring clean exit.

## [0.2.1] - 2026-01-13

### Added
- Users could now include recent commit messages in AI prompts, giving better context when generating suggestions.  
- Users could pick a commit type with a visual picker and see a progress spinner during release operations.  
- Users could generate a complete changelog and perform releases with a single command.  
- Users could build the tool for multiple platforms, install it via Homebrew, and run it on various operating systems.  
- Users could run interactive setup or teardown commands to configure or clean up the tool easily.  
- Users could select files interactively when no changes were staged.  
- Users could copy text to the clipboard across all supported platforms.  
- Users could opt to push commits immediately after creating them.  
- Users could now see an estimate of token usage and benefited from the improved OpenAI GPT‑OSS 20B model when generating.

### Changed
- The user interface was overhauled to improve usability and make the tool feel more modular.  
- Prompt generation was enhanced, providing clearer suggestions and reducing noise.  
- Keychain secret retrieval on macOS became faster and more reliable using a new API.  
- Cloudflare secret key handling was unified across all environments.  
- Secret storage now accepts environment variables and uses a minimal diff algorithm for efficiency.  
- Build prompts and configuration parsing were streamlined for smoother use.  

### Fixed
- Fixed crashes that occurred when the tool was run in a non‑git repository.  
- Fixed failures that caused the tool to crash after a push operation.  
- Fixed an issue on Linux where missing libsecret caused errors for all architectures.  
- Fixed noisy console output during git push by silencing extraneous messages.  
- Fixed errors related to loading non‑existent configuration or backup files.  

---

## [0.2.0] - 2026-01-06

### Added
- Users can interactively set up or tear down their secrets with new CLI commands.
- Users are prompted to push changes after committing.
- Users can select files interactively when no files are staged.
- Users can copy text to the clipboard across all operating systems with a simple command.
- Users can install the tool via Homebrew on macOS, Linux, and BSD.
- The AI commit‑message generator uses a more powerful model and displays estimated token usage.

### Changed
- The tool now stores credentials with a cross‑platform secrets API for greater reliability.
- Running the tool in a non‑Git repository or encountering a push failure now yields clear, non‑crashing error messages.

### Fixed
- Addressed a dependency issue that prevented Homebrew installation on Linux.
- Fixed improper handling of failed pushes, providing graceful error reporting.

