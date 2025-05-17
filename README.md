# 🤖 AI Call Trigger - Postman Setup Guide

This guide helps you test your AI voice call API using Postman. You'll learn how to set up a `POST` request that sends a call with a custom script and prompt.

---

## 🚀 Quick Start

### 1. Open Postman  
Launch Postman and create a **new request**.

### 2. Set Request Type  
Set the HTTP method to `POST`.

### 3. Enter API Endpoint  
Paste your ngrok or server URL with the endpoint:

```
http://NGROK_URL/make-call
```
🔁 Replace `NGROK_URL` with your actual forwarding URL (e.g., `https://1234abcd.ngrok.io`).

### 4. Configure Request Body  
- Navigate to the **Body** tab.
- Select **raw**.
- Set format to **JSON (application/json)**.

### 5. Add Request Payload  
Paste the following example:

```json
{
  "to": "+1234567890",
  "prompt": "You are a helpful AI assistant.",
  "initialScript": "Hello, I am your AI assistant. How can I help you today?"
}
```
📌 Replace `+1234567890` with the phone number you want to call (in international format).