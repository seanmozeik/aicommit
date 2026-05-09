class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.4.0"
  license "MIT"

  url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-#{version}.tar.gz"
  sha256 "877e74efd9086cb544a26ed655917a9b7cb2e5f3561fc1fc89c22a85f4d4defe"

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
