class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.4.0"
  license "MIT"

  url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-#{version}.tar.gz"
  sha256 "a0a31ea0e9fe81767462cc0daa70788094488faaa91f90c4c980e84aedd5f05d"

  depends_on "bun"

  on_linux do
    depends_on "libsecret"
  end

  def install
    libexec.install Dir["*"]
    (bin/"aic").write <<~EOS
      #!/bin/bash
      exec bun "#{libexec}/aic.js" "$@"
    EOS
  end

  test do
    assert_match "aic", shell_output("#{bin}/aic --help")
  end
end
