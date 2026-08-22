package com.vantara.exe;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Android WebView defaults to requiring a user gesture for <audio>/<video>
    // playback. ElevenLabs TTS playback (VoiceChatOverlay's speakWithElevenLabs)
    // calls audio.play() only after an async network round-trip completes, well
    // after the tap that started the turn — WebView no longer considers that a
    // live gesture, so play() rejects with NotAllowedError and falls back to
    // silence. Disabling the requirement is the standard fix for in-app TTS.
    this.bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

    // NOTE: do NOT call setWebChromeClient() here.
    //
    // Bridge.initWebView() installs Capacitor's BridgeWebChromeClient, which is
    // what implements onShowFileChooser (every <input type="file"> in the app),
    // onJsAlert / onJsConfirm / onJsPrompt (window.alert / confirm / prompt),
    // and onPermissionRequest. Replacing it with a plain WebChromeClient that
    // only overrides onPermissionRequest silently drops the other three:
    //
    //   - the chat Attach button opened no picker at all — a bare
    //     WebChromeClient returns false from onShowFileChooser, so nothing
    //     happens on tap;
    //   - window.confirm() resolved false without ever showing a dialog, so
    //     the Gallery's delete button bailed at its confirmation guard and
    //     appeared to do nothing;
    //   - window.alert() was swallowed, hiding the upload/delete error paths.
    //
    // The audio-capture handling that override existed for is redundant:
    // BridgeWebChromeClient.onPermissionRequest already requests RECORD_AUDIO
    // and MODIFY_AUDIO_SETTINGS for AUDIO_CAPTURE (and CAMERA for
    // VIDEO_CAPTURE) before granting, using the ActivityResult API rather than
    // the deprecated onRequestPermissionsResult path. Both permissions are
    // declared in AndroidManifest.xml, so getUserMedia({audio:true}) keeps
    // working with no code here.
  }
}
