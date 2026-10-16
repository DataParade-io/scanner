export class SearchComponent {
  headers = { Authorization: "Bearer token" };

  log() {
    return fetch("/api/clienteventlog/log");
  }
}
