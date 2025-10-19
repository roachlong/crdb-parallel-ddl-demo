env "dev" {
  url = env("ATLAS_URL")
  migration {
    dir = "file://migrations/base"
  }
}
