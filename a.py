import requests

url = "http://ai-platform.xwfintech.com/v1/audio/speech"

headers = {
    "Authorization": "Bearer sk-TVW20q1nDJ0o7ts1B6mpXiGQ2APDXgusANPv7n6gPQldBuQ1"
}

data = {
    "model": "IndexTTS-1.5",
    "voice": "度小雯",
    "input": "你好",
}


response = requests.post(url, headers=headers, json=data)

print(response.content)