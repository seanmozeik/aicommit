# Homebrew formula for aic - AI-powered commit message generator
# To use: brew install seanmozeik/tap/aic

class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.2.7"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-arm64.tar.gz"
      sha256 "2d4184d1ab2e009d7cb3b54be86cd3912104298d9f9e3a81abf7d84664db44b2"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-x64.tar.gz"
      sha256 "9126ac17ac51e474448e1fff2597a0476fb719b49ae0ed8c00bdce5f69b080ec"
    end
  end

  on_linux do
    depends_on "libsecret"

    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-arm64.tar.gz"
      sha256 "9b89c5052231411eb77e5f05c203f0f91783a31ba4dc4dcb6a35cf4199619861"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-x64.tar.gz"
      sha256 "ce6f4d3e4be86146973e1d5ee94018304fb7c58631cfe4fd8a667a6f96340cd6"
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
