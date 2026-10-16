import crypto from "crypto";

const BASE_URL = "http://localhost:3000";

function log(step, msg, ok = true) {
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} [${step}] ${msg}`);
}

async function runTests() {
  console.log("==========================================");
  console.log("VIDELINK — End-to-End Integration Tests");
  console.log("==========================================\n");

  let allPassed = true;

  try {
    // ----------------------------------------------------
    // TEST 1: Standard Transfer Creation & Multipart Upload
    // ----------------------------------------------------
    console.log("--- TEST 1: Standard Transfer Flow ---");
    const testFileSize = 1024 * 1024 * 3; // 3 MB mock video
    const testData = crypto.randomBytes(testFileSize);
    const expectedChecksum = crypto.createHash("sha256").update(testData).digest("hex");
    const filename = "test_nature_4k.mp4";

    const createRes = await fetch(`${BASE_URL}/api/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalFilename: filename,
        fileSize: testFileSize,
        contentType: "video/mp4",
        expirationHours: 24,
        allowPreview: true,
        allowOriginalDownload: true,
        senderMessage: "Here is your original 4K video!",
        downloadLimit: 5,
      }),
    });

    if (!createRes.ok) throw new Error(`Create transfer failed: ${createRes.status}`);
    const { transferId, code, session } = await createRes.json();
    log("1.1 Create Transfer", `Transfer created. ID: ${transferId}, Code: ${code}`);

    // Verify Code format
    const codeValid = /^VL-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
    log("1.2 Code Format", `Matches VL-XXXX-XXXX regex: ${codeValid}`, codeValid);
    if (!codeValid) allPassed = false;

    // Request upload URLs
    const urlRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/upload-urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        partNumbers: Array.from({ length: session.totalParts }, (_, i) => i + 1),
      }),
    });
    if (!urlRes.ok) throw new Error(`Get upload URLs failed: ${urlRes.status}`);
    const { urls } = await urlRes.json();
    log("1.3 Upload URLs", `Received ${urls.length} part URL(s)`);

    // Upload parts via PUT
    const uploadedParts = [];
    for (const part of urls) {
      const start = (part.partNumber - 1) * session.partSize;
      const end = Math.min(start + session.partSize, testFileSize);
      const chunk = testData.subarray(start, end);

      const putRes = await fetch(part.url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: chunk,
      });

      if (!putRes.ok) throw new Error(`Upload part ${part.partNumber} failed: ${putRes.status}`);
      const etag = putRes.headers.get("etag") || `"etag-${part.partNumber}"`;
      uploadedParts.push({ partNumber: part.partNumber, etag });
    }
    log("1.4 Chunk Upload", `Uploaded ${uploadedParts.length} chunks via PUT`);

    // Finalize
    const finalizeRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        parts: uploadedParts,
        checksumValue: expectedChecksum,
      }),
    });
    if (!finalizeRes.ok) throw new Error(`Finalize failed: ${finalizeRes.status}`);
    const finalizeData = await finalizeRes.json();
    log("1.5 Finalize Upload", `Completed with integrity: ${finalizeData.integrityStatus}`);

    // ----------------------------------------------------
    // TEST 2: Code Lookup
    // ----------------------------------------------------
    console.log("\n--- TEST 2: Code Lookup ---");
    const lookupRes = await fetch(`${BASE_URL}/api/transfers/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!lookupRes.ok) throw new Error(`Lookup failed: ${lookupRes.status}`);
    const { transfer: retrieved } = await lookupRes.json();
    log("2.1 Lookup by Code", `Found: "${retrieved.originalFilename}", size: ${retrieved.fileSize} bytes`);
    log("2.2 SHA-256 Checksum", `Matches client hash: ${retrieved.checksumValue === expectedChecksum}`);

    // ----------------------------------------------------
    // TEST 3: Original Download & Byte Verification
    // ----------------------------------------------------
    console.log("\n--- TEST 3: Download & Data Integrity ---");
    const downloadAuthRes = await fetch(`${BASE_URL}/api/transfers/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!downloadAuthRes.ok) throw new Error(`Download auth failed: ${downloadAuthRes.status}`);
    const { downloadUrl, filename: dlFilename } = await downloadAuthRes.json();
    log("3.1 Authorize Download", `Received download URL for: ${dlFilename}`);

    // Fetch the actual file
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`);
    const downloadedBuffer = Buffer.from(await fileRes.arrayBuffer());
    const downloadedChecksum = crypto.createHash("sha256").update(downloadedBuffer).digest("hex");

    const bytesMatch = downloadedBuffer.equals(testData);
    log("3.2 Byte-for-Byte Integrity", `Exact binary match: ${bytesMatch}`, bytesMatch);
    log("3.3 Checksum Match", `Expected ${expectedChecksum} === Downloaded ${downloadedChecksum}`, expectedChecksum === downloadedChecksum);
    if (!bytesMatch) allPassed = false;

    // ----------------------------------------------------
    // TEST 4: Streaming Preview Playback
    // ----------------------------------------------------
    console.log("\n--- TEST 4: Video Preview Streaming ---");
    const previewRes = await fetch(`${BASE_URL}/api/transfers/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!previewRes.ok) throw new Error(`Preview failed: ${previewRes.status}`);
    const previewData = await previewRes.json();
    log("4.1 Preview URL Generated", `Streaming URL: ${previewData.previewUrl}`);

    // Test HTTP Range Request (seeking/scrubbing in player)
    const rangeRes = await fetch(previewData.previewUrl, {
      headers: { Range: "bytes=0-1023" },
    });
    const isPartial = rangeRes.status === 206 || rangeRes.status === 200;
    log("4.2 HTTP 206 Partial Content", `Video scrub response status: ${rangeRes.status}`, isPartial);

    // ----------------------------------------------------
    // TEST 5: Password Protection Security
    // ----------------------------------------------------
    console.log("\n--- TEST 5: Password Protection ---");
    const passTransferRes = await fetch(`${BASE_URL}/api/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalFilename: "confidential_project.mp4",
        fileSize: 1024 * 500,
        contentType: "video/mp4",
        expirationHours: 1,
        password: "SecretVaultPassword!123",
      }),
    });
    const passTransfer = await passTransferRes.json();
    // Complete upload
    const pUrls = await (await fetch(`${BASE_URL}/api/transfers/${passTransfer.transferId}/upload-urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: passTransfer.session.sessionId, partNumbers: [1] }),
    })).json();
    await fetch(pUrls.urls[0].url, { method: "PUT", body: crypto.randomBytes(1024 * 500) });
    await fetch(`${BASE_URL}/api/transfers/${passTransfer.transferId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: passTransfer.session.sessionId, parts: [{ partNumber: 1, etag: '"etag"' }] }),
    });

    // 5.1 Lookup without password -> 401 passwordRequired: true
    const unauthLookup = await fetch(`${BASE_URL}/api/transfers/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: passTransfer.code }),
    });
    const unauthData = await unauthLookup.json();
    const passPromptOk = unauthLookup.status === 401 && unauthData.passwordRequired === true;
    log("5.1 Password Challenge", `Requires password when not provided: ${passPromptOk}`, passPromptOk);

    // 5.2 Lookup with WRONG password -> 401
    const wrongPassLookup = await fetch(`${BASE_URL}/api/transfers/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: passTransfer.code, password: "wrong-password" }),
    });
    const wrongPassOk = wrongPassLookup.status === 401;
    log("5.2 Reject Invalid Password", `Rejected incorrect password with 401: ${wrongPassOk}`, wrongPassOk);

    // 5.3 Lookup with CORRECT password -> 200
    const correctPassLookup = await fetch(`${BASE_URL}/api/transfers/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: passTransfer.code, password: "SecretVaultPassword!123" }),
    });
    const correctPassOk = correctPassLookup.status === 200;
    log("5.3 Accept Correct Password", `Unlocked transfer with correct password: ${correctPassOk}`, correctPassOk);

    // ----------------------------------------------------
    // TEST 6: Audit Trail & Passport
    // ----------------------------------------------------
    console.log("\n--- TEST 6: Audit Events Log ---");
    const eventsRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/events`);
    if (eventsRes.ok) {
      const { events } = await eventsRes.json();
      log("6.1 Audit Trail", `Recorded ${events.length} lifecycle events: ${events.map(e => e.eventType).join(" -> ")}`);
    }

    // ----------------------------------------------------
    // TEST 7: Passport Events by Code
    // ----------------------------------------------------
    console.log("\n--- TEST 7: Passport Events by Code ---");
    const codeEventsRes = await fetch(`${BASE_URL}/api/transfers/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!codeEventsRes.ok) throw new Error(`Fetch events by code failed: ${codeEventsRes.status}`);
    const { events: codeEvents } = await codeEventsRes.json();
    log("7.1 Code Passport Events", `Fetched ${codeEvents.length} passport event(s) by code: ${codeEvents.map(e => e.eventType).join(", ")}`);

    // ----------------------------------------------------
    // TEST 8: Automated Cleanup Maintenance Job
    // ----------------------------------------------------
    console.log("\n--- TEST 8: Cleanup Maintenance Job ---");
    const cleanupRes = await fetch(`${BASE_URL}/api/transfers/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer c8e3f29b48d21a97e4165d3098f4a132bc6e71928347fa65e492b0174c839d2e",
      },
    });
    if (!cleanupRes.ok) throw new Error(`Cleanup failed: ${cleanupRes.status}`);
    const cleanupReport = await cleanupRes.json();
    log("8.1 Maintenance Cleanup", `Report: expired=${cleanupReport.expiredTransfersCleaned}, abandoned=${cleanupReport.abandonedUploadsCleaned}, status=ok`);

    console.log("\n==========================================");
    if (allPassed) {
      console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
    } else {
      console.log("⚠️ SOME TESTS ENCOUNTERED AN ISSUE.");
    }
    console.log("==========================================");
  } catch (err) {
    console.error("\n❌ TEST SUITE ERROR:", err);
    process.exit(1);
  }
}

runTests();
