package expo.modules.pagetext

import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Printed and handwritten text on a page photo, with where each piece is.
 * Returns lines and their words with boxes as fractions of the image (0..1),
 * so callers don't need to know the photo's pixel size.
 */
class PageTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PageText")

    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val path = Uri.parse(uri).path ?: uri
      val bitmap = BitmapFactory.decodeFile(path)
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
