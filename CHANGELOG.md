# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

