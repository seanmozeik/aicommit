class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.4.0"
  license "MIT"

  url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-#{version}.tar.gz"
  sha256 "6078c3db1669c8f140ca0280043c14a33a49666eec81d79b9ac98d746f36bfe7"

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
