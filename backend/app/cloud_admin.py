"""Run on the server to issue/revoke friend invitations without exposing keys."""
import argparse
import os
from pathlib import Path

from .cloud_gateway import Registry


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["invite", "revoke"])
    parser.add_argument("--data-dir", default=os.getenv("LINGO_CLOUD_DATA_DIR", "cloud-data"))
    parser.add_argument("--hours", type=int, default=168)
    parser.add_argument("--token", help="Client token to revoke; never pass it in shared logs")
    arguments = parser.parse_args()
    registry = Registry(Path(arguments.data_dir))
    if arguments.command == "invite":
        print(registry.create_invitation(arguments.hours))
    elif not arguments.token:
        parser.error("--token is required for revoke")
    else:
        print("revoked" if registry.revoke(arguments.token) else "not found")


if __name__ == "__main__":
    main()
