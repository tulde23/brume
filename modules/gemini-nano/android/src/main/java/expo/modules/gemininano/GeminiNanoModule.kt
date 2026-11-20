package expo.modules.gemininano

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.common.StreamingCallback
import com.google.mlkit.genai.prompt.Candidate
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerationConfig
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.ImagePart
import com.google.mlkit.genai.prompt.ModelConfig
import com.google.mlkit.genai.prompt.ModelPreference
import com.google.mlkit.genai.prompt.ModelReleaseStage
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** An ML Kit error with its code kept, so JS can tell BUSY (retry) from NOT_SUPPORTED (give up). */
class GeminiNanoException(message: String, val genAiCode: Int, cause: Throwable?) :
  CodedException("ERR_GEMINI_NANO_$genAiCode", message, cause)

/**
 * Thin bridge to the ML Kit GenAI Prompt API (Gemini Nano via AICore).
 * Everything document-specific stays in JS; this only checks status,
 * downloads the model, and runs one image+text request at a time.
 */
class GeminiNanoModule : Module() {
  private var model: GenerativeModel? = null
  private var modelPreference: Int = ModelPreference.FULL

  private fun client(): GenerativeModel =
    model ?: run {
      val modelConfig = ModelConfig.builder().apply {
        releaseStage = ModelReleaseStage.STABLE
        preference = modelPreference
      }.build()
      val config = GenerationConfig.Builder().apply { this.modelConfig = modelConfig }.build()
      Generation.getClient(config).also { model = it }
    }

  private fun wrap(e: Throwable): Throwable =
    if (e is GenAiException) GeminiNanoException(e.message ?: "Gemini Nano error ${e.errorCode}", e.errorCode, e)
    else e

  private fun loadBitmap(uri: String): Bitmap {
    val path = Uri.parse(uri).path ?: uri
    return BitmapFactory.decodeFile(path) ?: throw IllegalArgumentException("Could not read image $uri")
  }

  override fun definition() = ModuleDefinition {
    Name("GeminiNano")
    Events("onDownloadProgress", "onText")

    /** "full" is the larger, more accurate variant; "fast" trades accuracy for speed. */
    Function("setPreference") { preference: String ->
      val next = if (preference == "fast") ModelPreference.FAST else ModelPreference.FULL
      if (next != modelPreference) {
        modelPreference = next
        model?.close()
        model = null
      }
    }

    AsyncFunction("checkStatus") Coroutine { ->
      try {
        when (client().checkStatus()) {
          FeatureStatus.AVAILABLE -> "available"
          FeatureStatus.DOWNLOADABLE -> "downloadable"
          FeatureStatus.DOWNLOADING -> "downloading"
          else -> "unavailable"
        }
      } catch (e: Throwable) {
        throw wrap(e)
      }
    }

    AsyncFunction("baseModelName") Coroutine { ->
      try { client().getBaseModelName() } catch (e: Throwable) { throw wrap(e) }
    }

    AsyncFunction("download") Coroutine { ->
      var failure: Throwable? = null
      var total = 0L
      client().download().collect { status ->
        when (status) {
          is DownloadStatus.DownloadStarted -> {
            total = status.bytesToDownload
            sendEvent("onDownloadProgress", mapOf("bytes" to 0.0, "total" to total.toDouble()))
          }
          is DownloadStatus.DownloadProgress ->
            sendEvent(
              "onDownloadProgress",
              mapOf("bytes" to status.totalBytesDownloaded.toDouble(), "total" to total.toDouble()),
            )
          is DownloadStatus.DownloadFailed -> failure = status.e
          else -> Unit // DownloadCompleted
        }
      }
      failure?.let { throw wrap(it) }
    }

    AsyncFunction("warmup") Coroutine { ->
      try { client().warmup() } catch (e: Throwable) { throw wrap(e) }
    }

    /**
     * One request: images (file:// URIs) + prompt. Streams text chunks as "onText"
     * events (with requestId) so JS can show progress, and returns the full text.
     */
    AsyncFunction("generate") Coroutine { requestId: Int, imageUris: List<String>, system: String?, prompt: String, maxOutputTokens: Int, temperature: Double ->
      if (imageUris.size > 1) {
        throw IllegalArgumentException("Gemini Nano takes one image per request")
      }
      val image = imageUris.firstOrNull()?.let { ImagePart(loadBitmap(it)) }
      val text = TextPart(prompt)
      val configure: com.google.mlkit.genai.prompt.GenerateContentRequest.Builder.() -> Unit = {
        this.temperature = temperature.toFloat()
        this.topK = 1
        this.maxOutputTokens = maxOutputTokens
      }
      val sys = system?.let { SystemInstruction(it) }
      val request = when {
        image != null && sys != null -> generateContentRequest(sys, image, text, configure)
        image != null -> generateContentRequest(image, text, configure)
        sys != null -> generateContentRequest(sys, text, configure)
        else -> generateContentRequest(text, configure)
      }
      try {
        val response = client().generateContent(
          request,
          object : StreamingCallback {
            override fun onNewText(text: String) {
              sendEvent("onText", mapOf("requestId" to requestId, "chars" to text.length))
            }
          },
        )
        val candidate = response.candidates.firstOrNull()
        mapOf(
          "text" to (candidate?.text ?: ""),
          "hitTokenLimit" to (candidate?.finishReason == Candidate.FinishReason.MAX_TOKENS),
        )
      } catch (e: Throwable) {
        throw wrap(e)
      }
    }

    OnDestroy {
      model?.close()
      model = null
    }
  }
}
