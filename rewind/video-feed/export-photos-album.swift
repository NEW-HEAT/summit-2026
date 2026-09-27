import AVFoundation
import AppKit
import Foundation
import Photos

struct ExportFailure: Error, CustomStringConvertible {
  let message: String
  var description: String { message }
}

@main
enum PhotosAlbumExporter {
  @MainActor
  static func main() {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = ExportApplicationDelegate(arguments: CommandLine.arguments)
    application.delegate = delegate
    application.run()
    exit(delegate.exitCode)
  }

  static func run(arguments: [String]) async -> Int32 {
    guard arguments.count == 3 else {
      fputs("Usage: export-photos-album <album name> <destination directory>\n", stderr)
      return 64
    }

    let albumName = arguments[1]
    let destination = URL(fileURLWithPath: arguments[2], isDirectory: true)

    do {
      try FileManager.default.createDirectory(
        at: destination,
        withIntermediateDirectories: true
      )

      let authorization = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
      guard authorization == .authorized || authorization == .limited else {
        throw ExportFailure(message: "Photos access was not granted (status \(authorization.rawValue)).")
      }

      let collections = PHAssetCollection.fetchAssetCollections(
        with: .album,
        subtype: .any,
        options: nil
      )
      var album: PHAssetCollection?
      collections.enumerateObjects { collection, _, stop in
        if collection.localizedTitle == albumName {
          album = collection
          stop.pointee = true
        }
      }
      guard let album else {
        throw ExportFailure(message: "Album not found: \(albumName)")
      }

      let assets = PHAsset.fetchAssets(in: album, options: nil)
      print("ALBUM \(albumName) ASSETS \(assets.count)")

      // Stable logical names avoid publishing personal camera filenames.
      // AVFoundation/FFmpeg inspect the original MOV/MP4 bytes, not this suffix.
      var successes = 0
      var skipped = 0
      var failures: [(String, String)] = []

      for index in 0..<assets.count {
        let asset = assets.object(at: index)
        guard asset.mediaType == .video else {
          continue
        }

        let resources = PHAssetResource.assetResources(for: asset)
        guard let resource = preferredVideoResource(from: resources) else {
          failures.append(("asset-\(index + 1)", "no video resource"))
          continue
        }

        let albumPosition = index + 1
        let fileName = String(format: "source-%02d.mov", albumPosition)
        let output = uniqueOutputURL(for: fileName, in: destination)
        if existingOutputURL(for: fileName, in: destination) != nil {
          skipped += 1
          print("SKIP \(index + 1)/\(assets.count) \(fileName)")
          continue
        }

        print("START \(index + 1)/\(assets.count) \(fileName)")
        do {
          try await write(resource: resource, to: output, label: fileName)
          let bytes = try output.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
          successes += 1
          print("DONE \(index + 1)/\(assets.count) \(fileName) \(bytes) bytes")
        } catch {
          try? FileManager.default.removeItem(at: output)
          failures.append((fileName, String(describing: error)))
          print("FAIL \(index + 1)/\(assets.count) \(fileName): \(error)")
        }
      }

      print("SUMMARY downloaded=\(successes) skipped=\(skipped) failed=\(failures.count)")
      for (fileName, error) in failures {
        print("ERROR \(fileName): \(error)")
      }
      return failures.isEmpty ? 0 : 1
    } catch {
      fputs("FATAL \(error)\n", stderr)
      return 1
    }
  }

  private static func preferredVideoResource(from resources: [PHAssetResource]) -> PHAssetResource? {
    let order: [PHAssetResourceType] = [.fullSizeVideo, .video, .pairedVideo]
    for type in order {
      if let resource = resources.first(where: { $0.type == type }) {
        return resource
      }
    }
    return resources.first
  }

  private static func existingOutputURL(for fileName: String, in directory: URL) -> URL? {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    guard let match = names.first(where: { $0.caseInsensitiveCompare(fileName) == .orderedSame }) else {
      return nil
    }
    let url = directory.appendingPathComponent(match)
    guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 65_536 else {
      return nil
    }
    return url
  }

  private static func uniqueOutputURL(for fileName: String, in directory: URL) -> URL {
    var candidate = directory.appendingPathComponent(fileName)
    var suffix = 2
    let stem = candidate.deletingPathExtension().lastPathComponent
    let ext = candidate.pathExtension
    while FileManager.default.fileExists(atPath: candidate.path) {
      candidate = directory.appendingPathComponent("\(stem)-\(suffix).\(ext)")
      suffix += 1
    }
    return candidate
  }

  private static func write(resource: PHAssetResource, to output: URL, label: String) async throws {
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = true
    var lastBucket = -1
    options.progressHandler = { progress in
      let bucket = Int(progress * 10)
      if bucket > lastBucket {
        lastBucket = bucket
        print("PROGRESS \(label) \(bucket * 10)%")
      }
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      PHAssetResourceManager.default().writeData(
        for: resource,
        toFile: output,
        options: options
      ) { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume()
        }
      }
    }
  }
}

@MainActor
final class ExportApplicationDelegate: NSObject, NSApplicationDelegate {
  let arguments: [String]
  var exitCode: Int32 = 1

  init(arguments: [String]) {
    self.arguments = arguments
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    Task {
      exitCode = await PhotosAlbumExporter.run(arguments: arguments)
      NSApplication.shared.terminate(nil)
    }
  }
}
