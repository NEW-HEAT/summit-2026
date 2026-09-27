import Foundation
import AVFoundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

// Local-only pose and person matte extraction. Never uploads the source video.
let args = CommandLine.arguments
guard args.count == 3 || args.count == 4 else { fatalError("Usage: analyze-bridge-gait <source-video> <new-output-directory> [frame-count]") }
let frameCount = args.count == 4 ? Int(args[3])! : 420
let source = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2], isDirectory: true)
guard !FileManager.default.fileExists(atPath: output.path) else { fatalError("Output already exists; refusing overwrite") }
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let asset = AVURLAsset(url: source)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
generator.maximumSize = CGSize(width: 960, height: 540)
let context = CIContext(options: [.cacheIntermediates: false])
let segmentation = VNGeneratePersonSegmentationRequest()
segmentation.qualityLevel = .accurate
segmentation.outputPixelFormat = kCVPixelFormatType_OneComponent8
let pose = VNDetectHumanBodyPoseRequest()
let names: [(String, VNHumanBodyPoseObservation.JointName)] = [
  ("nose", .nose), ("neck", .neck), ("root", .root),
  ("leftShoulder", .leftShoulder), ("rightShoulder", .rightShoulder),
  ("leftElbow", .leftElbow), ("rightElbow", .rightElbow),
  ("leftWrist", .leftWrist), ("rightWrist", .rightWrist),
  ("leftHip", .leftHip), ("rightHip", .rightHip),
  ("leftKnee", .leftKnee), ("rightKnee", .rightKnee),
  ("leftAnkle", .leftAnkle), ("rightAnkle", .rightAnkle)
]
var frames: [[String: Any]] = []
var maskFacts: [[String: Any]] = []
var previousRoot = CGPoint(x: 0.38, y: 0.62)
for frame in 0..<frameCount {
  try autoreleasepool {
    let image = try generator.copyCGImage(at: CMTime(value: Int64(frame), timescale: 30), actualTime: nil)
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
    try handler.perform([pose, segmentation])
    let candidates = pose.results ?? []
    // Track the central, tall runner, not incidental passersby at image edges.
    let selected = candidates.max { a, b in
      func score(_ observation: VNHumanBodyPoseObservation) -> Double {
        guard let root = try? observation.recognizedPoint(.root), root.confidence > 0.1 else { return -100 }
        let points = (try? observation.recognizedPoints(.all))?.values.filter { $0.confidence > 0.15 } ?? []
        let ys = points.map { $0.y }
        let height = (ys.max() ?? 0) - (ys.min() ?? 0)
        let distance = hypot(root.x - previousRoot.x, (1 - root.y) - previousRoot.y)
        return height * 2 - distance * 3
      }
      return score(a) < score(b)
    }
    var joints: [String: [Double]] = [:]
    if let selected {
      for (label, name) in names {
        if let point = try? selected.recognizedPoint(name), point.confidence > 0.05 {
          joints[label] = [point.x, 1 - point.y, Double(point.confidence)]
        }
      }
      if let root = joints["root"] { previousRoot = CGPoint(x: root[0], y: root[1]) }
    }
    guard let buffer = segmentation.results?.first?.pixelBuffer else { fatalError("Missing person matte") }
    let person = CIImage(cvPixelBuffer: buffer)
    let expanded = person.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": 1.5])
      .applyingFilter("CIGaussianBlur", parameters: ["inputRadius": 0.45])
      .cropped(to: person.extent)
    let inverse = expanded.applyingFilter("CIColorInvert")
    guard let png = context.pngRepresentation(of: inverse, format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB()) else {
      fatalError("Cannot encode person matte")
    }
    let name = String(format: "mask-%05d.png", frame)
    try png.write(to: output.appendingPathComponent(name), options: .atomic)
    maskFacts.append(["file": name, "sha256": SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()])
    frames.append(["frame": frame, "seconds": Double(frame) / 30, "joints": joints, "detectedPeople": candidates.count])
    if frame % 30 == 0 { print("analyzed \(frame)/\(frameCount)"); fflush(stdout) }
  }
}
let sourceHash = SHA256.hash(data: try Data(contentsOf: source)).map { String(format: "%02x", $0) }.joined()
let payload: [String: Any] = [
  "schemaVersion": 1, "method": "Apple Vision local 2D body pose and accurate person segmentation",
  "sourceSha256": sourceHash, "fps": 30, "frameRange": [0, frameCount - 1], "durationSeconds": Double(frameCount) / 30,
  "coordinateSystem": "normalized-image-top-left-not-geographic", "frames": frames,
  "maskConvention": "white-keeps-trail-black-occludes-person",
  "privacy": "Local-only analysis; source URL, identifiers and geographic coordinates are not stored."
]
try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
  .write(to: output.appendingPathComponent("pose.json"), options: .atomic)
try JSONSerialization.data(withJSONObject: ["sourceSha256": sourceHash, "masks": maskFacts], options: [.prettyPrinted, .sortedKeys])
  .write(to: output.appendingPathComponent("mask-hashes.json"), options: .atomic)
print("Completed \(frameCount) local pose and person-matte frames")
