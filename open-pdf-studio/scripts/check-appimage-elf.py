#!/usr/bin/env python3
"""Reject ELF files whose program header table overwrites an allocated section.

linuxdeploy can grow an ELF's program headers while adding an RPATH. On a
tightly packed library this can replace the first bytes of .gnu.hash, making
the AppImage crash inside the dynamic loader before the application starts.
"""

import pathlib
import struct
import sys


def check_file(path: pathlib.Path) -> list[str]:
    with path.open("rb") as source:
        header = source.read(64)
        if header[:4] != b"\x7fELF":
            return []
        if len(header) < 64 or header[4:6] != b"\x02\x01":
            return [f"{path}: unsupported or truncated ELF header"]

        program_offset, section_offset = struct.unpack_from("<QQ", header, 32)
        program_size, program_count, section_size, section_count = struct.unpack_from(
            "<HHHH", header, 54
        )
        file_size = path.stat().st_size
        program_end = program_offset + program_size * program_count
        section_end = section_offset + section_size * section_count
        if (program_size < 56 or program_end > file_size or
                (section_count and (section_size < 64 or section_end > file_size))):
            return [f"{path}: invalid ELF header table bounds"]

        # Some stripped ELF files have no section table. There is nothing to
        # compare against the program headers in that case.
        if section_count == 0:
            return []

        errors = []
        for index in range(section_count):
            source.seek(section_offset + index * section_size)
            section = source.read(64)
            kind, flags = struct.unpack_from("<IQ", section, 4)
            data_offset, data_size = struct.unpack_from("<QQ", section, 24)
            # SHT_NOBITS occupies no bytes in the file; SHF_ALLOC marks
            # sections that the loader may use at runtime.
            if kind == 8 or not (flags & 2) or data_size == 0:
                continue
            if data_offset < program_end and data_offset + data_size > program_offset:
                errors.append(
                    f"{path}: program headers end at 0x{program_end:x} and "
                    f"overlap allocated section #{index} at 0x{data_offset:x}"
                )
        return errors


def main(root: pathlib.Path) -> int:
    if not root.is_dir():
        print(f"AppDir not found: {root}", file=sys.stderr)
        return 2
    errors = []
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            errors.extend(check_file(path))
    if errors:
        print("AppImage contains damaged ELF files:", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <AppDir>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(pathlib.Path(sys.argv[1])))
