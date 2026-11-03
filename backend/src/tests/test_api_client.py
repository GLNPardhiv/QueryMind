# src/tests/test_api_client.py
import requests

def test_sql_generation():
    url = "http://127.0.0.1:8000/api/v1/generate-sql"
    
    payload = {
        "query": "List all product names and their current inventory counts."
    }
    
    print(f"Sending query: '{payload['query']}'\n")
    
    try:
        response = requests.post(url, json=payload)
        
        # If the server crashes, print exactly WHY it crashed
        if response.status_code != 200:
            print(f"❌ Server Error {response.status_code}: {response.text}")
            return
            
        data = response.json()
        print("✅ Pipeline Success!")
        print(f"Status: {data['status']}")
        print(f"Tables Used: {data['context_tables_used']}")
        print("-" * 40)
        print(f"Generated SQL:\n{data['sql']}")
        print("-" * 40)
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Connection Error: Ensure your FastAPI server is running. {e}")

if __name__ == "__main__":
    test_sql_generation()