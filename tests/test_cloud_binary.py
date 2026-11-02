"""Exercise snapshot parameters through the actual python-tds wire serializers."""
from io import BytesIO
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from backend import cloud_state
from tests.test_cloud import FakeStore

try:
    from pytds import tds_base, tds_types, tds_reader, tds_writer
except ImportError:
    TDS_AVAILABLE = False
else:
    TDS_AVAILABLE = True


class MemoryTransport:
    def __init__(self):
        self.output = BytesIO()
        self.input = None

    def sendall(self, data):
        self.output.write(data)

    def recv_into(self, buffer, size):
        if self.input is None:
            self.input = BytesIO(self.output.getvalue())
        data = self.input.read(size)
        buffer[:len(data)] = data
        return len(data)


def tds_roundtrip(value):
    factory = tds_types.SerializerFactory(tds_base.TDS74)
    sql_type = tds_types.TdsTypeInferrer(factory, bytes_to_unicode=True).from_value(value)
    serializer = factory.serializer_by_type(sql_type)
    transport = MemoryTransport()
    writer = tds_writer._TdsWriter(transport, bufsize=4096, tds_session=None)
    writer.begin_packet(tds_base.PacketType.REPLY)
    serializer.write_info(writer)
    serializer.write(writer, value)
    writer.flush()
    reader = tds_reader._TdsReader(tds_session=None, transport=transport)
    reader.begin_response()
    received_serializer = factory.get_type_serializer(serializer.type).from_stream(reader)
    return sql_type, received_serializer.read(reader)


@unittest.skipUnless(TDS_AVAILABLE, "Install optional Azure runtime dependencies for TDS serialization checks.")
class BinarySnapshotTests(unittest.TestCase):
    def test_non_utf8_snapshots_roundtrip_as_varbinary_and_varbinary_max(self):
        class SerializingStore(FakeStore):
            sql_type = None

            def execute(self, sql, params=()):
                if sql.startswith("UPDATE"):
                    self.sql_type, self.pending = tds_roundtrip(params[0])

        for size, expected_type in ((512, tds_types.VarBinaryType), (20000, tds_types.VarBinaryMaxType)):
            with self.subTest(size=size), tempfile.TemporaryDirectory(prefix="genie-binary-test-") as temporary:
                root = Path(temporary) / "data-genie"
                content = random.Random(42).randbytes(size)
                store = SerializingStore()
                cloud_state._version = None
                cloud_state._store_identity = None
                try:
                    with patch.dict("os.environ", {"GENIE_DATA_DIR": str(root),
                                    "GENIE_PUBLIC_URL": "https://genie.example.test", "GENIE_CONNECTION_KEY": "fixture"}), \
                            patch.object(cloud_state, "connect", return_value=store):
                        with cloud_state.transaction():
                            (root / "fixture.bin").write_bytes(content)
                        self.assertEqual(store.revision, 1)
                        self.assertIsInstance(store.sql_type, expected_type)
                        # The old plain-bytes binding hits the driver's Unicode
                        # conversion and fails on this same ZIP payload.
                        with self.assertRaises(tds_base.DatabaseError) as old_binding:
                            tds_roundtrip(store.payload)
                        self.assertIsInstance(old_binding.exception.__context__, UnicodeDecodeError)
                        with zipfile.ZipFile(BytesIO(store.payload)) as archive:
                            self.assertEqual(archive.read("fixture.bin"), content)
                        cloud_state.restore(root, None)
                        cloud_state._version = None
                        with cloud_state.transaction():
                            self.assertEqual((root / "fixture.bin").read_bytes(), content)
                        self.assertEqual(store.revision, 1)
                finally:
                    cloud_state._version = None
                    cloud_state._store_identity = None
