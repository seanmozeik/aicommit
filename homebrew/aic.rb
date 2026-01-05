# typed: false
# frozen_string_literal: true

# Homebrew formula for AIC (AI Commit)
# AI-powered conventional commit message generator
class Aic < Formula
  desc "AI-powered conventional commit message generator"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_ARM64_SHA256"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_ARM64_SHA256"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-x64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_X64_SHA256"

      # Linux requires libsecret for credential storage
      depends_on "libsecret"
    end
  end

  def install
    if OS.mac?
      if Hardware::CPU.arm?
        bin.install "aic-darwin-arm64" => "aic"
      else
        bin.install "aic-darwin-x64" => "aic"
      end
    elsif OS.linux?
      if Hardware::CPU.arm?
        bin.install "aic-linux-arm64" => "aic"
      else
        bin.install "aic-linux-x64" => "aic"
      end
    end
  end

  def caveats
    <<~EOS
      To configure Cloudflare AI credentials, run:
        aic setup

      Or set environment variables:
        export AIC_CLOUDFLARE_ACCOUNT_ID=your-account-id
        export AIC_CLOUDFLARE_API_TOKEN=your-api-token
    EOS
  end

  test do
    # Test that the binary runs
    assert_match "AIC", shell_output("#{bin}/aic --help 2>&1", 1)
  end
end
