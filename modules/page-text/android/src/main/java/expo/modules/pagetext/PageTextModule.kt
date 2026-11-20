package expo.modules.pagetext

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Printed and handwritten text on a page photo, with where each piece is.
 * Returns lines and their words with boxes as fractions of the UPRIGHT image
 * (0..1): camera photos are often stored sideways with an EXIF rotation, and
 * positions must match what the user sees and what the cropper produces.
 */
class PageTextModule : Module() {
  /** Decode and apply the EXIF orientation, so the bitmap is the way the photo is shown. */
  private fun uprightBitmap(path: String): Bitmap? {
    val raw = BitmapFactory.decodeFile(path) ?: return null
    val degrees = try {
      when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    } catch (e: Exception) {
      0f
    }
    if (degrees == 0f) return raw
    val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(degrees) }, true)
    if (rotated != raw) raw.recycle()
    return rotated
  }

  override fun definition() = ModuleDefinition {
    Name("PageText")

    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val path = Uri.parse(uri).path ?: uri
      val bitmap = uprightBitmap(path)
      if (bitmap == null) {
        promise.reject("ERR_PAGE_TEXT_IMAGE", "Could not read image $uri", null)
        return@AsyncFunction
      }
      val w = bitmap.width.toDouble()
      val h = bitmap.height.toDouble()
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      recognizer.process(InputImage.fromBitmap(bitmap, 0))
        .addOnSuccessListener { result ->
          fun box(r: android.graphics.Rect?): Map<String, Double>? = r?.let {
            mapOf("x" to it.left / w, "y" to it.top / h, "w" to it.width() / w, "h" to it.height() / h)
          }
          val lines = result.textBlocks.flatMap { block ->
            block.lines.mapNotNull { line ->
              val rect = box(line.boundingBox) ?: return@mapNotNull null
              mapOf(
                "text" to line.text,
                "rect" to rect,
                "words" to line.elements.mapNotNull { e ->
                  box(e.boundingBox)?.let { mapOf("text" to e.text, "rect" to it) }
                },
              )
            }
          }
          bitmap.recycle()
          recognizer.close()
          promise.resolve(lines)
        }
        .addOnFailureListener { e ->
          bitmap.recycle()
          recognizer.close()
          promise.reject("ERR_PAGE_TEXT", e.message ?: "Text recognition failed", e)
        }
    }
  }
}
