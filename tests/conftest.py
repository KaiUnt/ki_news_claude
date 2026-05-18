import os
import sys

# Ensure the project root is on sys.path so `import backend.*` works.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Minimal env vars required before any backend module is imported.
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
