class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.4.0"
  license "MIT"

  url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-#{version}.tar.gz"
  sha256 "9e2f099f32c4f233e1559b33357b53b1bf6aea1adad60d3ee66eaaa30a4ee436"

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
