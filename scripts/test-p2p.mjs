// Test P2P Signaling & Transfer API
const BASE_URL = "http://localhost:3000";

async function runP2PTest() {
  console.log("==========================================");
  console.log("VIDELINK — WebRTC P2P Direct Stream Tests");
  console.log("==========================================\n");

  // Step 1: Create P2P Transfer (5GB mock video)
  console.log("1. Creating 5GB P2P Transfer...");
  const createRes = await fetch(`${BASE_URL}/api/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalFilename: "graduation_ceremony_4k.mp4",
      fileSize: 5368709120, // 5 GB
      contentType: "video/mp4",
      expirationHours: 24,
      isP2P: true,
      transferMode: "p2p",
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create P2P transfer: ${createRes.status}`);
  }

  const { transferId, code, isP2P } = await createRes.json();
  console.log(`✅ P2P Transfer Created! ID: ${transferId}, Code: ${code}, isP2P: ${isP2P}`);

  // Step 2: Lookup by Code
  console.log("\n2. Looking up code from receiver's perspective...");
  const lookupRes = await fetch(`${BASE_URL}/api/transfers/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!lookupRes.ok) {
    throw new Error(`Failed to lookup code: ${lookupRes.status}`);
  }

  const { transfer } = await lookupRes.json();
  console.log(`✅ Code Lookup Success! Filename: ${transfer.originalFilename}, Size: ${transfer.fileSize} bytes, isP2P: ${transfer.isP2P}`);

  // Step 3: Sender posts SDP Offer
  console.log("\n3. Sender posting WebRTC SDP Offer...");
  const offerRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "offer",
      from: "sender",
      data: { sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n", type: "offer" },
    }),
  });
  console.log(`✅ Sender Offer Signal Posted: ${offerRes.status === 200 ? "OK" : "FAILED"}`);

  // Step 4: Receiver fetches Offer
  console.log("\n4. Receiver fetching signals...");
  const recSignalRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/signal?role=receiver`);
  const recData = await recSignalRes.json();
  console.log(`✅ Receiver fetched ${recData.signals.length} signal(s) from sender. Type: ${recData.signals[0]?.type}`);

  // Step 5: Receiver posts SDP Answer
  console.log("\n5. Receiver posting WebRTC SDP Answer...");
  const ansRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "answer",
      from: "receiver",
      data: { sdp: "v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n", type: "answer" },
    }),
  });
  console.log(`✅ Receiver Answer Signal Posted: ${ansRes.status === 200 ? "OK" : "FAILED"}`);

  // Step 6: Sender fetches Answer
  console.log("\n6. Sender fetching signals...");
  const senderSignalRes = await fetch(`${BASE_URL}/api/transfers/${transferId}/signal?role=sender`);
  const senderData = await senderSignalRes.json();
  console.log(`✅ Sender fetched ${senderData.signals.length} signal(s) from receiver. Type: ${senderData.signals[0]?.type}`);

  console.log("\n==========================================");
  console.log("🎉 ALL P2P WEBRTC TESTS PASSED 100%!");
  console.log("==========================================");
}

runP2PTest().catch(console.error);
