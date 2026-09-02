# What's Next

In progress:

{% for issue in query(status="in_progress", sort="priority") %}
- [{{ issue.key }}]({{ issue.id }}) {{ issue.title }} ({{ issue.type }}, P{{ issue.priority }})
{% endfor %}

{% if count(status="in_progress") == 0 %}
None.
{% endif %}

Open (not findings; those are tracked on [corpus gold status](corpus-gold-status.md)):

{% for issue in query(status="open", sort="priority") %}
{% if issue.type != "finding" %}
- [{{ issue.key }}]({{ issue.id }}) {{ issue.title }} ({{ issue.type }}, P{{ issue.priority }})
{% endif %}
{% endfor %}
