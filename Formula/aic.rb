class Aic < Formula
  desc "AI-powered commit message generator using conventional commit format"
  homepage "https://github.com/seanmozeik/AICommit"
  version "0.4.0"
  license "MIT"

  url "https://github.com/seanmozeik/AICommit/releases/download/v#{version}/aic-#{version}.tar.gz"
  sha256 "d462e72757ce63fd5f1694cfe1fd3073ad747e20fb099edc046228bca720127d"

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
