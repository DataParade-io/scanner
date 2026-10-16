using ServiceStack;

[Route("/todos", "GET")]
public class QueryTodos : IGet
{
}

[Route("/hello/{Name}")]
public class Hello : IGet
{
}
