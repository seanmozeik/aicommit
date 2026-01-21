# Homebrew formula for aic - AI-powered commit message generator
# To use: brew install seanmozeik/tap/aic

class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.2.8"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-arm64.tar.gz"
      sha256 "981a1e453fb7db9cd11e2f6f5210bda2b3334ecc1fee256e1a21d15fb74f8a92"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-x64.tar.gz"
      sha256 "b383610ec884155c0bfb5d7ba04b8aabf210a42864b1164040ab5c15def0097f"
    end
  end

  on_linux do
    depends_on "libsecret"

    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-arm64.tar.gz"
      sha256 "fd7267cf0cd91fdf7e1d7d3327853ff43af2488c58c58b5594d5b194fee9f732"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-x64.tar.gz"
      sha256 "04507ceaf7d92076d530b764f1f38c951bdc74d4832f6090ead2a228c74b1640"
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
