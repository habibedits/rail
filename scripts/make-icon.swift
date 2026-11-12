// Builds build/icon.icns from a square artwork image:
//   swift scripts/make-icon.swift <image>
// The art is placed on a white macOS-style rounded square (824/1024 grid) with a soft shadow.
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let art = NSImage(contentsOfFile: args[1]) else {
  print("usage: swift scripts/make-icon.swift <image>"); exit(1)
}
let fm = FileManager.default
let iconset = "build/icon.iconset"
try? fm.removeItem(atPath: iconset)
try! fm.createDirectory(atPath: iconset, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                             bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(px) / 1024
  let tile = NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
  let path = NSBezierPath(roundedRect: tile, xRadius: 185 * s, yRadius: 185 * s)
  let shadow = NSShadow()
  shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
  shadow.shadowBlurRadius = 18 * s
  shadow.shadowOffset = NSSize(width: 0, height: -8 * s)
  NSGraphicsContext.saveGraphicsState()
  shadow.set()
  NSColor.white.setFill()
  path.fill()
  NSGraphicsContext.restoreGraphicsState()
  NSGraphicsContext.saveGraphicsState()
  path.addClip()
  let inset = 40 * s  // a little breathing room inside the tile
  art.draw(in: tile.insetBy(dx: inset, dy: inset), from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128),
                   ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
  try! render(px).write(to: URL(fileURLWithPath: "\(iconset)/icon_\(name).png"))
}
try! render(1024).write(to: URL(fileURLWithPath: "build/icon.png"))
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", iconset, "-o", "build/icon.icns"]
try! p.run(); p.waitUntilExit()
print(p.terminationStatus == 0 ? "wrote build/icon.icns" : "iconutil failed")
