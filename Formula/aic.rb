# Homebrew formula for aic - AI-powered commit message generator
# To use: brew install seanmozeik/tap/aic

class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.2.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-arm64.tar.gz"
      sha256 ""
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-x64.tar.gz"
      sha256 ""
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-arm64.tar.gz"
      sha256 ""
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-x64.tar.gz"
      sha256 ""
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

  test do
    assert_match "aic", shell_output("#{bin}/aic --help")
  end
end
