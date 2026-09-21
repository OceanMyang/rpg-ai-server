import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

url = "https://openrouter.ai/api/v1/chat/completions"
model = "nvidia/nemotron-3.5-lightning:free"
api_key = os.getenv("API_KEY")

# First API call with reasoning
response = requests.post(
  url=url,
  headers={
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
  },
  data=json.dumps({
    "model": model,
    "messages": [
        {
          "role": "user",
          "content": "Who are you?"
        }
      ],
    "reasoning": {"enabled": True}
  })
)

# Extract the assistant message with reasoning_details
response = response.json()
response = response['choices'][0]['message']
print(response['content'])

# Preserve the assistant message with reasoning_details
messages = [
  {"role": "user", "content": "How many r's are in the word 'strawberry'?"},
  {
    "role": "assistant",
    "content": response.get('content')
  },
  {"role": "user", "content": "Are you sure? Think carefully."}
]

# Second API call - model continues reasoning from where it left off
response2 = requests.post(
  headers={
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
  },
  url=url,
  data=json.dumps({
    "model": model,
    "messages": messages,  # Includes preserved reasoning_details
    "reasoning": {"enabled": True}
  })
)

response2 = response2.json()
print(response2)