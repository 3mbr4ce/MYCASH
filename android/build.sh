#!/bin/sh
# Build the MYCASH Android APK without Gradle (same approach as MYYT): aapt2 + javac + d8 + zipalign + apksigner.
# Needs JDK 17 and Android SDK platform 34 + build-tools 34.0.0.
#   ./build.sh [release|debug]
# Release signing: KEYSTORE (default ../keys/mycash-release.jks) and KS_PASS (default: contents of ../keys/release.pass).
# The keystore is created on the first release build and must be reused for every later version (updates install over).
set -eu
cd "$(dirname "$0")"
VARIANT=${1:-release}
SDK=${ANDROID_SDK:-/workspace/.android-tools/sdk}
BT=$SDK/build-tools/34.0.0
JAR=$SDK/platforms/android-34/android.jar
JAVA_HOME=${JAVA_HOME:-$(ls -d /workspace/.android-tools/jdk-17* | head -1)}
export PATH="$JAVA_HOME/bin:$PATH"
OUT=build/$VARIANT
rm -rf "$OUT" && mkdir -p "$OUT/res" "$OUT/classes" "$OUT/assets" "$OUT/gen"
python3 ../tools/build-web.py "$OUT/assets/index.html"
MAN=AndroidManifest.xml
if [ "$VARIANT" = debug ]; then
  sed 's/<application /<application android:debuggable="true" /' AndroidManifest.xml > "$OUT/AndroidManifest.xml"; MAN=$OUT/AndroidManifest.xml
fi
"$BT/aapt2" compile --dir res -o "$OUT/res/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest "$MAN" -A "$OUT/assets" --java "$OUT/gen" "$OUT/res/res.zip" --min-sdk-version 26 --target-sdk-version 34
javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 -bootclasspath "$JAR" -cp libs/zxing-core-3.5.3.jar -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$JAR" --output "$OUT" $(find "$OUT/classes" -name '*.class') libs/zxing-core-3.5.3.jar
cp "$OUT/base.apk" "$OUT/unsigned.apk"
python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'a',zipfile.ZIP_DEFLATED); z.write(sys.argv[2],'classes.dex'); z.close()" "$OUT/unsigned.apk" "$OUT/classes.dex"
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
if [ "$VARIANT" = debug ]; then
  KS=${KEYSTORE:-../keys/mycash-debug.jks}; PASS=${KS_PASS:-android}; ALIAS=mycashdebug
else
  KS=${KEYSTORE:-../keys/mycash-release.jks}; ALIAS=mycash
  if [ -z "${KS_PASS:-}" ]; then
    if [ ! -f ../keys/release.pass ]; then mkdir -p ../keys; python3 -c "import secrets;print(secrets.token_urlsafe(24))" > ../keys/release.pass; chmod 600 ../keys/release.pass; fi
    PASS=$(cat ../keys/release.pass)
  else PASS=$KS_PASS; fi
fi
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass "$PASS" -keypass "$PASS" -alias "$ALIAS" -keyalg RSA -keysize 3072 -validity 18250 \
    -dname "CN=MYCASH, O=MYSUITE" >/dev/null 2>&1
  chmod 600 "$KS"
  echo "created new keystore $KS"
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$PASS" --ks-key-alias "$ALIAS" --out "$OUT/MYCASH-$VARIANT.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$OUT/MYCASH-$VARIANT.apk"
ls -l "$OUT/MYCASH-$VARIANT.apk"
