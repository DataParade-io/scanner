using Microsoft.AspNetCore.Mvc;

[ApiController]
public class ClientEventLogController : ControllerBase
{
    [HttpPost("api/clienteventlog/log")]
    public IActionResult Log() => Ok();
}
