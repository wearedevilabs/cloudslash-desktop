# CloudSlash build targets.
#
#   make build          build the CLI          -> bin/cloudslash
#   make desktop        build the desktop GUI  -> bin/cloudslash-desktop
#   make test           run the test suite
#   make vet            run go vet
#   make fmt            format all Go source
#   make run-demo       run a headless demo scan (no AWS account needed)
#   make clean          remove build output

VERSION ?= $(shell cat VERSION 2>/dev/null || echo dev)
LDFLAGS := -s -w -X github.com/DrSkyle/cloudslash/v2/pkg/version.Current=$(VERSION)
GOARGS ?=

.PHONY: all build cli desktop test vet fmt tidy run-demo clean

all: build desktop

## build: compile the CLI (aka `make cli`)
build: cli

cli:
	@mkdir -p bin
	go build $(GOARGS) -ldflags "$(LDFLAGS)" -o bin/cloudslash ./cmd/cloudslash-cli
	@echo "built bin/cloudslash ($(VERSION))"

## desktop: compile the Fyne desktop application
desktop:
	@mkdir -p bin
	go build $(GOARGS) -ldflags "$(LDFLAGS)" -o bin/cloudslash-desktop ./cmd/cloudslash-desktop
	@echo "built bin/cloudslash-desktop ($(VERSION))"

test:
	go test $(GOARGS) ./pkg/... ./cmd/...

vet:
	go vet $(GOARGS) ./...

fmt:
	gofmt -w $$(find cmd pkg -name '*.go' -type f)

tidy:
	go mod tidy

## run-demo: headless scan against synthetic data
run-demo: cli
	./bin/cloudslash scan --mock --headless

## desktop-run: build and launch the desktop app
desktop-run: desktop
	./bin/cloudslash-desktop

clean:
	rm -rf bin cloudslash-out
