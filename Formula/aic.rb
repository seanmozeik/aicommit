# Homebrew formula for aic - AI-powered commit message generator
# To use: brew install seanmozeik/tap/aic

class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.2.9"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-arm64.tar.gz"
      sha256 "0f172da26fea569d04b6d56ebd2f1c20d63b4c954e600c21472ddf51c556eefe"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-darwin-x64.tar.gz"
      sha256 "c09f85c1f7228502d18cd885446479cf33962a8123da042dde969c0acccd1f6b"
    end
  end

  on_linux do
    depends_on "libsecret"

    if Hardware::CPU.arm?
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-arm64.tar.gz"
      sha256 "f615161330085cfcfd6850174f009bcb9f291f699bb9d438ed8a9bc1fdacc6a9"
    else
      url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-linux-x64.tar.gz"
      sha256 "2180e5ab34c28ea503da0da7b7fe53bee6f86045ac92d4fcc9fc69506e3b1cca"
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
