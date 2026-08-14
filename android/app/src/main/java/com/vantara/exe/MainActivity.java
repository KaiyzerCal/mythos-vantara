package com.vantara.exe;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

// getUserMedia({audio: true}) (VoiceChatOverlay's LIVE mode) needs two
// independent layers of permission on Android before the WebView will hand
// over the microphone: the RECORD_AUDIO runtime permission (requested
// here), AND the WebView's own PermissionRequest.grant() for
// RESOURCE_AUDIO_CAPTURE (also handled here) — the OS permission dialog
// alone does not make WebView grant getUserMedia; both must be satisfied.
public class MainActivity extends BridgeActivity {
  private static final int RECORD_AUDIO_REQUEST_CODE = 6001;
  private PermissionRequest pendingWebPermissionRequest;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        for (String resource : request.getResources()) {
          if (resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
              request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            } else {
              pendingWebPermissionRequest = request;
              ActivityCompat.requestPermissions(
                  MainActivity.this,
                  new String[] { Manifest.permission.RECORD_AUDIO },
                  RECORD_AUDIO_REQUEST_CODE
              );
            }
            return;
          }
        }
        request.deny();
      }
    });
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
    if (requestCode == RECORD_AUDIO_REQUEST_CODE) {
      if (pendingWebPermissionRequest != null) {
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
          pendingWebPermissionRequest.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
          pendingWebPermissionRequest.deny();
        }
        pendingWebPermissionRequest = null;
      }
      return;
    }
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
  }
}
