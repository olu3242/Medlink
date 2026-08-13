import argparse

from .bulk import run_bulk


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("--adapter-commit", required=True)
    parser.add_argument("--parser-version", required=True)
    args = parser.parse_args()
    print(run_bulk(__import__("pathlib").Path(args.output), args.adapter_commit, args.parser_version))


if __name__ == "__main__":
    main()
