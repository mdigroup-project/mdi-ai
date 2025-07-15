// ฟังก์ชันสำหรับคุยกับ OpenAI Assistant API
async function getOpenAIAssistantResponse(userMessage, apiKey, assistantId) {
  const openaiApiUrl = 'https://api.openai.com/v1';

  try {
    // 1. สร้าง thread ใหม่
    const threadResponse = await fetch(`${openaiApiUrl}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });
    const thread = await threadResponse.json();
    const threadId = thread.id;

    // 2. เพิ่มข้อความของผู้ใช้ลงใน thread
    await fetch(`${openaiApiUrl}/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({ role: 'user', content: userMessage })
    });

    // 3. สั่งให้ Assistant เริ่มรันบน thread
    const runResponse = await fetch(`${openaiApiUrl}/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({ assistant_id: assistantId })
    });
    const run = await runResponse.json();
    const runId = run.id;

    // 4. รอผลลัพธ์จาก run
    let runStatus;
    let attempts = 0;
    do {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const statusResponse = await fetch(`${openaiApiUrl}/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      const status = await statusResponse.json();
      runStatus = status.status;
      attempts++;
    } while ((runStatus === 'in_progress' || runStatus === 'queued') && attempts < 20);

    if (runStatus !== 'completed') {
      return 'ขออภัยค่ะ ระบบตอบช้ากว่าปกติ กรุณาลองใหม่อีกครั้ง';
    }

    // 5. ดึงข้อความตอบกลับจาก Assistant
    const messagesResponse = await fetch(`${openaiApiUrl}/threads/${threadId}/messages`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });
    const messagesData = await messagesResponse.json();
    const assistantMessage = messagesData.data.find(m => m.role === 'assistant');

    // ✨ จุดที่แก้ไข: ลบชื่อไฟล์ออกจากคำตอบก่อนส่งกลับ
    if (assistantMessage && assistantMessage.content[0].type === 'text') {
      const rawText = assistantMessage.content[0].text.value;
      const cleanedText = rawText.replace(/【.*?】\.?/g, '').trim();
      return cleanedText;
    }

    return 'ไม่พบคำตอบจาก Assistant ค่ะ';
  } catch (error) {
    console.error('OpenAI Error:', error);
    return 'ขออภัยค่ะ ระบบมีปัญหาในการเชื่อมต่อกับ AI';
  }
}

// ฟังก์ชันสำหรับส่งข้อความกลับไปที่ LINE
async function replyMessage(accessToken, replyToken, textToSend) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  };
  const body = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: textToSend }]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('LINE Reply Failed:', errorText);
  }
}

// Handler หลักสำหรับ Vercel
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).send('Method Not Allowed');
  }

  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const ASSISTANT_ID = process.env.ASSISTANT_ID;

  if (!LINE_TOKEN || !OPENAI_KEY || !ASSISTANT_ID) {
    console.error('❌ Missing environment variables');
    return response.status(500).send('Configuration Error');
  }

  try {
    const body = request.body;
    const events = body.events || [];

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text' && event.replyToken) {
        console.log(`👤 User: ${event.message.text}`);
        const assistantResponse = await getOpenAIAssistantResponse(
          event.message.text,
          OPENAI_KEY,
          ASSISTANT_ID
        );
        console.log(`🤖 Assistant: ${assistantResponse}`);
        await replyMessage(LINE_TOKEN, event.replyToken, assistantResponse);
      } else {
        console.log('📭 No valid message or replyToken found.');
      }
    }

    return response.status(200).send('OK');
  } catch (error) {
    console.error('Top-level Error:', error);
    return response.status(500).send('Internal Server Error');
  }
}
