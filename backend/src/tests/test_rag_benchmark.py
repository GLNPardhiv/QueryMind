# tests/test_rag_benchmark.py
import time
from src.db.inspector import schema_extractor
from src.services.vector_service import vector_service
from src.services.graph_service import SchemaGraphService
from src.services.query_translator import query_translator

def run_benchmark():
    print("1. Extracting schema catalog...")
    schema = schema_extractor.extract_full_schema()
    all_table_names = list(schema.keys())
    
    # Ingest only if Chroma is empty in production, but we force it here for testing
    vector_service.ingest_schema(schema)
    
    print("2. Initializing Pipeline Services...")
    graph_service = SchemaGraphService(schema)
    
    test_cases = [
        {
            "query": "Which customers placed the most expensive orders?",
            "expected_tables": {"customer", "salesorderheader", "salesorderdetail"}
        },
        {
            "query": "Who are our top spending clients?",
            "expected_tables": {"customer", "salesorderheader", "salesorderdetail"}
        },
        {
            "query": "List all product names and their current inventory counts.",
            "expected_tables": {"product", "productinventory"}
        },
        {
            "query": "Give me the names of employees in the engineering department.",
            "expected_tables": {"department", "employee", "employeedepartmenthistory"}
        },
        {
            "query": "What is the email address of Ken Sanchez?",
            "expected_tables": {"person", "emailaddress"}
        },
        {
            "query": "Find all product reviews and their ratings.",
            "expected_tables": {"product", "productreview"}
        },
        {
            "query": "Show me all purchase orders submitted to vendors.",
            "expected_tables": {"purchaseorderheader", "vendor"}
        },
        {
            "query": "Calculate the total freight cost for orders shipped via 'Cargo Transport 5'.",
            "expected_tables": {"salesorderheader", "shipmethod"}
        },
        {
            "query": "Find the names of all products that have been scrapped along with the specific scrap reason.",
            "expected_tables": {"workorder", "scrapreason", "product"}
        }
    ]

    total_recall = 0.0

    print("\n--- Running Enterprise RAG Benchmark ---")
    for i, test in enumerate(test_cases, 1):
        query = test["query"]
        expected = {t.lower() for t in test["expected_tables"]}

        # 1. Schema-Aware Pre-Retrieval Translation
        enriched_query = query_translator.expand_query(query, all_table_names)
        
        # 2. Hybrid Dense/Sparse Retrieval
        candidate_tables = vector_service.search_schemas(enriched_query, top_k_tables=8)
        
        # 3. Strict Graph FK Traversal
        retrieved_tables = set(graph_service.get_connecting_tables(candidate_tables))

        matched_tables = expected.intersection(retrieved_tables)
        recall = len(matched_tables) / len(expected) if expected else 0.0
        total_recall += recall

        status = "✅ PASS" if recall == 1.0 else "❌ FAIL"
        print(f"\nTest {i}: {query}")
        print(f"Status: {status} (Recall: {recall * 100:.0f}%)")
        print(f"  -> Enriched Query: {enriched_query.replace(query, '').strip()[:80]}...")
        print(f"  -> Final Graph Path: {retrieved_tables}")
        
        if recall < 1.0:
            missing = expected - retrieved_tables
            print(f"  -> Missing Tables: {missing}")

        # Sleep to avoid LLM API 429 Rate Limiting on free tiers
        time.sleep(15)

    avg_recall = (total_recall / len(test_cases)) * 100
    print(f"\n======================================")
    print(f"Final Enterprise Pipeline Accuracy: {avg_recall:.2f}%")
    print(f"======================================")

if __name__ == "__main__":
    run_benchmark()