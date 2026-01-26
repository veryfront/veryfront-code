# Homebrew formula for Veryfront CLI
#
# To use this formula:
#   1. Create a tap: veryfront/homebrew-tap
#   2. Copy this file to: homebrew-tap/Formula/veryfront.rb
#   3. Users can then: brew install veryfront/tap/veryfront
#
# Or submit to homebrew-core for: brew install veryfront

class Veryfront < Formula
  desc "Zero-config React meta-framework for AI-native applications"
  homepage "https://veryfront.com"
  license "MIT"
  version "VERSION_PLACEHOLDER"

  on_macos do
    on_arm do
      url "https://github.com/veryfront/veryfront/releases/download/vVERSION_PLACEHOLDER/veryfront-macos-arm64"
      sha256 "SHA256_MACOS_ARM64_PLACEHOLDER"
    end
    on_intel do
      url "https://github.com/veryfront/veryfront/releases/download/vVERSION_PLACEHOLDER/veryfront-macos-x64"
      sha256 "SHA256_MACOS_X64_PLACEHOLDER"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/veryfront/veryfront/releases/download/vVERSION_PLACEHOLDER/veryfront-linux-arm64"
      sha256 "SHA256_LINUX_ARM64_PLACEHOLDER"
    end
    on_intel do
      url "https://github.com/veryfront/veryfront/releases/download/vVERSION_PLACEHOLDER/veryfront-linux-x64"
      sha256 "SHA256_LINUX_X64_PLACEHOLDER"
    end
  end

  def install
    binary_name = "veryfront"
    if OS.mac?
      binary_name = Hardware::CPU.arm? ? "veryfront-macos-arm64" : "veryfront-macos-x64"
    elsif OS.linux?
      binary_name = Hardware::CPU.arm? ? "veryfront-linux-arm64" : "veryfront-linux-x64"
    end

    # The downloaded file is already the binary
    bin.install Dir["veryfront*"].first => "veryfront"
  end

  test do
    assert_match "veryfront", shell_output("#{bin}/veryfront --version")
  end
end
