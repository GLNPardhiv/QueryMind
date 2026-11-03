# app/services/graph_service.py
import networkx as nx
from typing import Dict, List
from src.models.schema_metadata import TableMetadata

class SchemaGraphService:
    def __init__(self, schema_data: Dict[str, TableMetadata]):
        self.graph = nx.Graph()
        self._build_graph(schema_data)

    def _build_graph(self, schema_data: Dict[str, TableMetadata]):
        schema_lower = {k.lower(): v for k, v in schema_data.items()}
        for table_name, metadata in schema_data.items():
            u = table_name.lower()
            self.graph.add_node(u)
            for fk in metadata.foreign_keys:
                v = fk.referred_table.lower()
                if v in schema_lower:
                    self.graph.add_edge(u, v)

    def get_connecting_tables(self, target_tables: List[str]) -> List[str]:
        targets = list(dict.fromkeys([t.lower() for t in target_tables if t.lower() in self.graph]))
        
        if not targets: return []
        if len(targets) == 1: return targets

        # Standard Shortest Path algorithm to safely join the LLM's selected tables
        subgraph_nodes = set(targets)
        for i in range(len(targets)):
            for j in range(i + 1, len(targets)):
                if nx.has_path(self.graph, targets[i], targets[j]):
                    path = nx.shortest_path(self.graph, source=targets[i], target=targets[j])
                    subgraph_nodes.update(path)
                        
        return list(subgraph_nodes)